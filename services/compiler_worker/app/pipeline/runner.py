from __future__ import annotations

import asyncio
import html
import os
import re
from dataclasses import asdict
from datetime import UTC, datetime

import httpx
import orjson

import logging

from llm_wiki_core.change_plan import ChangeAction, ChangePlan
from llm_wiki_core.config import get_settings
from llm_wiki_core.crypto import decrypt_value
from llm_wiki_core.db import acquire
from llm_wiki_core.embeddings import EmbeddingConfig, generate_embedding
from llm_wiki_core.llm import LLMConfig, invoke_structured
from llm_wiki_core.markdown_ops import append_markdown
from llm_wiki_core.metrics import CONVERTER_CALLS_TOTAL, CONVERTER_DURATION
from llm_wiki_core.parsing import ParsedDocument, parse_document
from llm_wiki_core.queue import publish_event
from llm_wiki_core.storage import get_bytes
from llm_wiki_core.tracing import inject_trace_headers, traced_span
from llm_wiki_core.write_journal import append_run_step, create_document, create_revision, record_activity, set_document_revision, update_run

logger = logging.getLogger(__name__)
CONVERTIBLE_SOURCE_EXTENSIONS = {"doc", "ppt", "pptx"}


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "item"


def _mermaid_label(value: str) -> str:
    return html.escape(value, quote=True).replace("\n", "<br/>")


def _mermaid_node(node_id: str, label: str) -> str:
    return f'{node_id}["{_mermaid_label(label)}"]'


def _mermaid_edge_label(value: str) -> str:
    return value.replace("|", "/")


def _vector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in values) + "]"


def _split_blocks(document: ParsedDocument) -> list[dict]:
    blocks: list[dict] = []
    for page in document.pages:
        headings: list[str] = []
        paragraph_lines: list[str] = []

        def flush_paragraph() -> None:
            if not paragraph_lines:
                return
            text = "\n".join(paragraph_lines).strip()
            if text:
                blocks.append(
                    {
                        "page_no": page.page_no,
                        "block_type": "table" if "|" in text and "---" in text else "paragraph",
                        "heading_path": list(headings),
                        "text": text,
                        "bbox": {},
                        "token_count": len(text.split()),
                    }
                )
            paragraph_lines.clear()

        for line in page.text_md.splitlines():
            if line.startswith("#"):
                flush_paragraph()
                heading = line.lstrip("#").strip()
                level = len(line) - len(line.lstrip("#"))
                headings = headings[: max(level - 1, 0)]
                headings.append(heading)
                blocks.append(
                    {
                        "page_no": page.page_no,
                        "block_type": "heading",
                        "heading_path": list(headings),
                        "text": heading,
                        "bbox": {},
                        "token_count": len(heading.split()),
                    }
                )
                continue
            if not line.strip():
                flush_paragraph()
                continue
            paragraph_lines.append(line)
        flush_paragraph()
    return blocks


EXTRACT_SYSTEM_TEMPLATE = """You are a knowledge-graph compiler. Given document text, extract structured entities, claims, and relations.

Return JSON with this exact structure:
```json
{{
  "entities": [
    {{"title": "...", "entity_type": "person|company|project|technology|concept|methodology|product|protocol|event|organization|other", "summary": "One-sentence summary"}}
  ],
  "claims": [
    {{"entity_title": "...", "text": "A factual claim about this entity", "confidence": 0.8, "quote": "Source text excerpt supporting the claim"}}
  ],
  "relations": [
    {{"source_title": "...", "target_title": "...", "relation_type": "uses|part_of|created_by|related_to|depends_on|competes_with|extends|implements"}}
  ]
}}
```

Rules:
- Extract {min_entities}-{max_entities} meaningful entities (not headings or generic terms)
- Each claim must be supported by text from the document
- Relations connect entities to each other
- Summaries should be concise and factual{custom_instructions}"""


def _get_compiler_rules(ws_settings: dict) -> dict:
    raw = ws_settings.get("compiler_rules") or {}
    return {
        "max_entities": max(5, min(int(raw.get("max_entities", 20)), 50)),
        "min_confidence": max(0.0, min(float(raw.get("min_confidence", 0.5)), 1.0)),
        "text_truncation_limit": max(4000, min(int(raw.get("text_truncation_limit", 12000)), 30000)),
        "custom_instructions": str(raw.get("custom_instructions", ""))[:500],
    }


def _build_extract_system(rules: dict) -> str:
    max_ent = rules["max_entities"]
    min_ent = max(3, max_ent // 4)
    custom = f"\n- {rules['custom_instructions']}" if rules["custom_instructions"] else ""
    return EXTRACT_SYSTEM_TEMPLATE.format(min_entities=min_ent, max_entities=max_ent, custom_instructions=custom)


def _build_llm_config(ws_settings: dict) -> LLMConfig:
    provider = ws_settings.get("llm_provider", "")
    model = ws_settings.get("llm_model", "")
    api_key = decrypt_value(
        ws_settings.get("llm_api_key_ciphertext"),
        ws_settings.get("llm_api_key_key_version"),
    )
    base_url = ws_settings.get("llm_base_url", "") or None
    if not provider or not model:
        raise RuntimeError(f"Workspace LLM configuration incomplete: provider='{provider}', model='{model}'")
    if not api_key:
        raise RuntimeError(f"Workspace LLM API key not configured (provider={provider})")
    return LLMConfig(provider=provider, model=model, api_key=api_key, base_url=base_url)


def _build_embedding_config(ws_settings: dict) -> EmbeddingConfig:
    settings = get_settings()
    api_key = decrypt_value(
        ws_settings.get("embedding_api_key_ciphertext"),
        ws_settings.get("embedding_api_key_key_version"),
    )
    base_url = ws_settings.get("embedding_base_url", "")
    model = ws_settings.get("embedding_model", "")
    if not api_key or not base_url:
        raise RuntimeError("Workspace embedding API key and base URL not configured")
    if not model:
        raise RuntimeError("Workspace embedding_model not configured")
    return EmbeddingConfig(api_key=api_key, base_url=base_url, model=model, dimensions=settings.embedding_dimensions)


async def _llm_extract(document: ParsedDocument, blocks: list[dict], llm_config: LLMConfig, compiler_rules: dict) -> dict:
    truncation = compiler_rules["text_truncation_limit"]
    full_text = "\n\n".join(page.text_md for page in document.pages)
    if len(full_text) > truncation:
        full_text = full_text[:truncation] + "\n\n[truncated]"

    system = _build_extract_system(compiler_rules)
    prompt = f"Document title: {document.title}\n\n{full_text}"
    result = await invoke_structured(system, prompt, config=llm_config, timeout_seconds=120)
    if isinstance(result, dict) and "entities" in result:
        return result
    raise RuntimeError(f"LLM extraction returned invalid payload for document '{document.title}'")


async def _extract_entities_and_graph(
    document: ParsedDocument,
    blocks: list[dict],
    llm_config: LLMConfig,
    compiler_rules: dict,
) -> tuple[list[dict], list[dict], list[dict]]:
    """Return (entities, claims, relations). Requires LLM — raises on failure."""
    llm_result = await _llm_extract(document, blocks, llm_config, compiler_rules)

    entities = []
    seen_slugs: set[str] = set()
    for raw in llm_result.get("entities", []):
        title = raw.get("title", "").strip()
        if not title:
            continue
        slug = _slugify(title)
        if slug in seen_slugs:
            continue
        seen_slugs.add(slug)
        entities.append({
            "slug": slug,
            "title": title,
            "entity_type": raw.get("entity_type", "concept"),
            "summary": raw.get("summary", f"{title} extracted from {document.title}."),
        })
    min_conf = compiler_rules["min_confidence"]
    claims = []
    for raw in llm_result.get("claims", []):
        conf = min(max(float(raw.get("confidence", 0.7)), 0.0), 1.0)
        if conf < min_conf:
            continue
        claims.append({
            "entity_title": raw.get("entity_title", ""),
            "text": raw.get("text", ""),
            "confidence": conf,
            "quote": raw.get("quote", "")[:400],
        })
    relations = []
    seen_rels: set[tuple[str, str, str]] = set()
    for raw in llm_result.get("relations", []):
        src = raw.get("source_title", "")
        tgt = raw.get("target_title", "")
        rtype = raw.get("relation_type", "related_to")
        key = (src, tgt, rtype)
        if key in seen_rels or not src or not tgt:
            continue
        seen_rels.add(key)
        relations.append({"source_title": src, "target_title": tgt, "relation_type": rtype})
    logger.info("LLM extraction: %d entities, %d claims, %d relations", len(entities), len(claims), len(relations))
    return entities, claims, relations


def _source_footer(document_title: str, page_no: int) -> str:
    return f"[^{page_no}]: {document_title}, p.{page_no}"


ENTITY_CATEGORY_MAP = {"person", "company", "organization", "project", "product", "protocol", "event"}


def _match_block_by_quote(quote: str, blocks: list[dict], fallback_page: int) -> dict:
    """Find the block best matching the quote text. Used by both footnote rendering and citation DB insertion."""
    if not quote:
        return {"page_no": fallback_page, "id": None, "text": ""}
    best, best_overlap = None, 0
    quote_words = quote.lower().split()[:10]
    for b in blocks:
        text_lower = b["text"].lower()
        overlap = sum(1 for w in quote_words if w in text_lower)
        if overlap > best_overlap:
            best, best_overlap = b, overlap
    if best:
        return best
    return {"page_no": fallback_page, "id": None, "text": ""}


def _build_change_plan(
    workspace_name: str,
    source_document: dict,
    parsed_document: ParsedDocument,
    entities: list[dict],
    claims: list[dict],
    relations: list[dict],
    blocks: list[dict],
) -> ChangePlan:
    source_title = source_document["title"]
    latest_page = next((block["page_no"] for block in blocks if block["text"].strip()), 1)
    actions: list[ChangeAction] = []
    entity_claims: dict[str, list[dict]] = {}
    for claim in claims:
        entity_claims.setdefault(claim["entity_title"], []).append(claim)

    entity_relations: dict[str, list[dict]] = {}
    for rel in relations:
        entity_relations.setdefault(rel["source_title"], []).append(rel)
        entity_relations.setdefault(rel["target_title"], []).append(rel)

    for entity in entities:
        category = "entities" if entity["entity_type"] in ENTITY_CATEGORY_MAP else "concepts"
        doc_path = f"/wiki/{category}/{entity['slug']}.md"
        summary = entity["summary"]

        evidence_lines = []
        footnote_pages: set[int] = set()
        for claim in entity_claims.get(entity["title"], []):
            conf = f"{claim['confidence']:.0%}"
            matched = _match_block_by_quote(claim.get("quote", ""), blocks, latest_page)
            pg = matched["page_no"]
            footnote_pages.add(pg)
            evidence_lines.append(f"- {claim['text']} (confidence: {conf})[^{pg}]")
        evidence_section = "\n".join(evidence_lines) if evidence_lines else f"{summary}[^{latest_page}]"
        if not footnote_pages:
            footnote_pages.add(latest_page)

        rel_lines = []
        source_node = _mermaid_node(entity["slug"], entity["title"])
        for rel in entity_relations.get(entity["title"], []):
            other = rel["target_title"] if rel["source_title"] == entity["title"] else rel["source_title"]
            target_node = _mermaid_node(_slugify(other), other)
            rel_lines.append(
                f"    {source_node} -->|{_mermaid_edge_label(rel['relation_type'])}| {target_node}"
            )
        mermaid_block = (
            "```mermaid\ngraph TD\n" + "\n".join(rel_lines) + "\n```"
            if rel_lines
            else (
                "```mermaid\n"
                "graph TD\n"
                f"    {_mermaid_node(f'source-{_slugify(source_title)}', source_title)} --> {source_node}\n"
                f"    {source_node} --> {_mermaid_node('compiled-wiki', 'Compiled Wiki')}\n"
                "```"
            )
        )

        doc_content = f"""{summary}

## Snapshot

| Attribute | Value |
| --- | --- |
| Type | {entity['entity_type']} |
| Source | {source_title} |
| Workspace | {workspace_name} |

{mermaid_block}

## Evidence

{evidence_section}

{chr(10).join(_source_footer(source_title, pg) for pg in sorted(footnote_pages))}
"""
        actions.append(
            ChangeAction(
                op="create_doc",
                path=doc_path,
                title=entity["title"],
                content=doc_content,
                reason=f"Compile {entity['entity_type']} from source {source_title}",
            )
        )

    log_line = f"""## [{datetime.now(UTC).date().isoformat()}] ingest | {source_title}
- Parsed {len(parsed_document.pages)} page(s)
- Extracted {len(entities)} entities, {len(claims)} claims, {len(relations)} relations
- Updated overview and compiled wiki pages
"""
    actions.append(
        ChangeAction(
            op="append_content",
            path="/wiki/log.md",
            title="Log",
            content=log_line,
            reason=f"Append ingest log for {source_title}",
        )
    )
    return ChangePlan(actions=actions, summary=f"Compiled {len(entities)} wiki nodes from {source_title}")


async def fail_run(run_id: str, workspace_id: str, error_message: str) -> None:
    async with acquire(workspace_id) as connection:
        await update_run(connection, run_id, status="failed", error_message=error_message[:1000], completed_now=True)
        await append_run_step(connection, run_id, "failed", "failed", error_message=error_message[:1000])
        await record_activity(
            workspace_id=workspace_id,
            actor_type="system",
            actor_id="compiler-worker",
            event_type="run.failed",
            payload={"error": error_message[:300]},
            run_id=run_id,
            connection=connection,
        )
    await publish_event(
        f"workspace:{workspace_id}",
        {"type": "run.failed", "payload": {"run_id": run_id, "error": error_message[:300]}},
    )


async def schedule_retry(run_id: str, workspace_id: str, error_message: str, next_attempt: int) -> None:
    async with acquire(workspace_id) as connection:
        await update_run(connection, run_id, status="queued", error_message=error_message[:1000])
        await append_run_step(
            connection,
            run_id,
            "retry_scheduled",
            "queued",
            payload={"attempt": next_attempt},
            error_message=error_message[:1000],
        )
        await record_activity(
            workspace_id=workspace_id,
            actor_type="system",
            actor_id="compiler-worker",
            event_type="run.retry_scheduled",
            payload={"error": error_message[:300], "attempt": next_attempt},
            run_id=run_id,
            connection=connection,
        )
    await publish_event(
        f"workspace:{workspace_id}",
        {"type": "run.retry_scheduled", "payload": {"run_id": run_id, "attempt": next_attempt}},
    )


async def _record_step(
    run_id: str,
    workspace_id: str,
    step_key: str,
    status: str,
    payload: dict | None = None,
    error_message: str | None = None,
) -> None:
    async with acquire(workspace_id) as connection:
        await append_run_step(connection, run_id, step_key, status, payload, error_message)


async def _upsert_entity(connection, workspace_id: str, entity: dict) -> str:
    row = await connection.fetchrow(
        """
        INSERT INTO entities (workspace_id, slug, title, entity_type, summary)
        VALUES ($1::uuid, $2, $3, $4, $5)
        ON CONFLICT (workspace_id, slug)
        DO UPDATE SET
            title = CASE WHEN length(EXCLUDED.title) >= length(entities.title) THEN EXCLUDED.title ELSE entities.title END,
            entity_type = EXCLUDED.entity_type,
            summary = CASE WHEN length(EXCLUDED.summary) > length(entities.summary) THEN EXCLUDED.summary ELSE entities.summary END
        RETURNING id::text AS id
        """,
        workspace_id,
        entity["slug"],
        entity["title"],
        entity["entity_type"],
        entity["summary"],
    )
    return row["id"]


async def _append_or_replace_document(
    connection,
    workspace_id: str,
    run_id: str,
    actor_id: str,
    action: ChangeAction,
) -> str:
    doc = await connection.fetchrow(
        """
        SELECT d.id::text AS id, d.policy::text AS policy, dr.content_md
        FROM documents d
        LEFT JOIN document_revisions dr ON dr.id = d.current_revision_id
        WHERE d.workspace_id = $1::uuid AND d.path = $2 AND d.archived_at IS NULL
        """,
        workspace_id,
        action.path,
    )

    if doc and action.op == "append_content":
        content_md = append_markdown(doc["content_md"] or "", action.content)
        document_id = doc["id"]
    elif doc:
        content_md = action.content
        document_id = doc["id"]
    else:
        created = await create_document(
            connection,
            workspace_id=workspace_id,
            kind="wiki",
            path=action.path,
            title=action.title,
            mime_type="text/markdown",
            status="ready",
            policy="system_managed",
        )
        document_id = created.id
        content_md = action.content

    revision = await create_revision(
        connection,
        document_id=document_id,
        actor_type="system",
        actor_id=actor_id,
        run_id=run_id,
        reason=action.reason,
        content_md=content_md,
        diff_summary={"op": action.op, "path": action.path},
    )
    await set_document_revision(connection, document_id, revision.id, status="ready")
    return document_id


async def process_run(run_id: str, workspace_id: str, attempts: int = 1) -> None:
    await _record_step(run_id, workspace_id, "start", "running", {"run_id": run_id, "attempt": attempts})
    async with acquire(workspace_id) as connection:
        run = await connection.fetchrow(
            """
            SELECT id::text AS id, workspace_id::text AS workspace_id, input, actor_id
            FROM runs
            WHERE id = $1::uuid
            """,
            run_id,
        )
        if not run:
            return
        document_id = run["input"]["document_id"]
        source_document = await connection.fetchrow(
            """
            SELECT id::text AS id, workspace_id::text AS workspace_id, title, path, metadata
            FROM documents
            WHERE id = $1::uuid
            """,
            document_id,
        )
        workspace = await connection.fetchrow(
            "SELECT name FROM workspaces WHERE id = $1::uuid",
            run["workspace_id"],
        )
        ws_settings_row = await connection.fetchrow(
            """
            SELECT llm_provider, llm_model, llm_api_key_ciphertext, llm_api_key_key_version, llm_base_url,
                   embedding_provider, embedding_model, embedding_api_key_ciphertext, embedding_api_key_key_version, embedding_base_url,
                   compiler_rules, search_rules
            FROM workspace_settings
            WHERE workspace_id = $1::uuid
            """,
            run["workspace_id"],
        )
        if not ws_settings_row:
            raise RuntimeError(f"No workspace_settings found for workspace {run['workspace_id']}")
        ws_settings = dict(ws_settings_row)
        llm_config = _build_llm_config(ws_settings)
        embedding_config = _build_embedding_config(ws_settings)
        compiler_rules = _get_compiler_rules(ws_settings)
        logger.info("run %s: using llm=%s/%s, embedding=%s, rules=%s", run_id, llm_config.provider, llm_config.model, embedding_config.model, compiler_rules)
        await update_run(connection, run_id, status="running", started_now=True)

    storage_key = source_document["metadata"]["storage_key"]
    file_name = source_document["metadata"]["filename"]
    source_ext = os.path.splitext(file_name or "")[1].lstrip(".").lower()

    if source_ext in CONVERTIBLE_SOURCE_EXTENSIONS:
        settings = get_settings()
        converted_key = f"{storage_key}.converted.pdf"
        import time

        start = time.perf_counter()
        headers = inject_trace_headers({})
        with traced_span(
            "converter.request",
            tracer_name="compiler-worker",
            attributes={"converter.source_ext": source_ext, "converter.source_object_key": storage_key},
        ):
            async with httpx.AsyncClient(timeout=120.0) as client:
                response = await client.post(
                    f"{settings.converter_url.rstrip('/')}/convert",
                    json={
                        "source_object_key": storage_key,
                        "target_object_key": converted_key,
                        "source_ext": source_ext,
                    },
                    headers={**headers, "Authorization": f"Bearer {settings.internal_service_token}"},
                )
                response.raise_for_status()
        CONVERTER_CALLS_TOTAL.labels(source_ext=source_ext, status="succeeded").inc()
        CONVERTER_DURATION.labels(source_ext=source_ext).observe(time.perf_counter() - start)
        raw_bytes = await asyncio.to_thread(get_bytes, converted_key)
        parsed = parse_document(f"{os.path.splitext(file_name)[0]}.pdf", raw_bytes, "application/pdf")
    else:
        raw_bytes = await asyncio.to_thread(get_bytes, storage_key)
        parsed = parse_document(file_name, raw_bytes, source_document["metadata"].get("mime_type"))
    blocks = _split_blocks(parsed)
    await _record_step(run_id, workspace_id, "parse", "succeeded", {"pages": len(parsed.pages), "blocks": len(blocks)})

    entities, claims, relations = await _extract_entities_and_graph(parsed, blocks, llm_config, compiler_rules)
    await _record_step(run_id, workspace_id, "extract", "succeeded", {
        "entities": len(entities), "claims": len(claims), "relations": len(relations),
    })
    block_embeddings = []
    for block in blocks:
        embedding = await generate_embedding(block["text"], embedding_config)
        block_embeddings.append({"block": block, "embedding": embedding})

    plan = _build_change_plan(workspace["name"], source_document, parsed, entities, claims, relations, blocks)
    await record_activity(
        workspace_id=run["workspace_id"],
        actor_type="system",
        actor_id="compiler-worker",
        event_type="run.started",
        payload={"run_type": "ingest", "document_id": document_id},
        run_id=run_id,
        document_id=document_id,
    )

    async with acquire(run["workspace_id"]) as connection:
        async with connection.transaction():
            full_source_content = "\n\n---\n\n".join(page.text_md for page in parsed.pages)
            source_revision = await create_revision(
                connection,
                document_id=document_id,
                actor_type="system",
                actor_id="compiler-worker",
                run_id=run_id,
                reason="Normalize source content",
                content_md=full_source_content,
                diff_summary={"op": "replace_section"},
            )
            await set_document_revision(connection, document_id, source_revision.id)
            await connection.execute("DELETE FROM document_pages WHERE document_id = $1::uuid", document_id)
            await connection.execute("DELETE FROM document_blocks WHERE document_id = $1::uuid", document_id)
            await connection.execute(
                "DELETE FROM claims WHERE id IN (SELECT claim_id FROM citations WHERE source_document_id = $1::uuid)",
                document_id,
            )
            await connection.execute("DELETE FROM citations WHERE source_document_id = $1::uuid", document_id)
            stale_rels = await connection.fetch(
                """
                SELECT id::text AS id, metadata
                FROM relations
                WHERE workspace_id = $1::uuid
                  AND metadata->'source_document_ids' ? $2
                """,
                run["workspace_id"],
                document_id,
            )
            for srel in stale_rels:
                src_ids = srel["metadata"].get("source_document_ids", [])
                remaining = [sid for sid in src_ids if sid != document_id]
                if remaining:
                    await connection.execute(
                        "UPDATE relations SET metadata = $2::jsonb WHERE id = $1::uuid",
                        srel["id"],
                        orjson.dumps({**srel["metadata"], "source_document_ids": remaining}).decode(),
                    )
                else:
                    await connection.execute("DELETE FROM relations WHERE id = $1::uuid", srel["id"])

            for page in parsed.pages:
                await connection.execute(
                    """
                    INSERT INTO document_pages (document_id, page_no, text_md, elements_json, char_count)
                    VALUES ($1::uuid, $2, $3, $4::jsonb, $5)
                    """,
                    document_id,
                    page.page_no,
                    page.text_md,
                    orjson.dumps(page.elements).decode(),
                    len(page.text_md),
                )

            block_rows = []
            for item in block_embeddings:
                block = item["block"]
                block_row = await connection.fetchrow(
                    """
                    INSERT INTO document_blocks (document_id, page_no, block_type, heading_path, text, bbox, token_count, embedding)
                    VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7, $8::vector)
                    RETURNING id::text AS id, page_no
                    """,
                    document_id,
                    block["page_no"],
                    block["block_type"],
                    block["heading_path"],
                    block["text"],
                    orjson.dumps(block["bbox"]).decode(),
                    block["token_count"],
                    _vector_literal(item["embedding"]),
                )
                block_rows.append({"id": block_row["id"], "page_no": block_row["page_no"], "text": block["text"]})

            fallback_block = next((row for row in block_rows if row["text"].strip()), {"id": None, "page_no": 1, "text": ""})

            def _find_best_block_row(quote: str) -> dict:
                if not quote:
                    return fallback_block
                best, best_overlap = fallback_block, 0
                quote_words = quote.lower().split()[:10]
                for row in block_rows:
                    text_lower = row["text"].lower()
                    overlap = sum(1 for w in quote_words if w in text_lower)
                    if overlap > best_overlap:
                        best, best_overlap = row, overlap
                return best

            entity_id_map: dict[str, str] = {}
            for entity in entities:
                entity_id = await _upsert_entity(connection, run["workspace_id"], entity)
                entity_id_map[entity["title"]] = entity_id

            for claim_data in claims:
                entity_title = claim_data.get("entity_title", "")
                entity_id = entity_id_map.get(entity_title)
                if not entity_id:
                    continue
                claim = await connection.fetchrow(
                    """
                    INSERT INTO claims (workspace_id, entity_id, canonical_text, confidence, metadata)
                    VALUES ($1::uuid, $2::uuid, $3, $4, '{"source":"compiler"}'::jsonb)
                    RETURNING id::text AS id
                    """,
                    run["workspace_id"],
                    entity_id,
                    claim_data["text"][:1000],
                    claim_data.get("confidence", 0.72),
                )
                quote = claim_data.get("quote", "")
                matched_block = _find_best_block_row(quote)
                cite_quote = quote[:400] if quote else matched_block["text"][:400]
                precision = "exact_match" if quote else "fallback"
                await connection.execute(
                    """
                    INSERT INTO citations (workspace_id, claim_id, source_document_id, source_block_id, page_no, quote_text, metadata)
                    VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::jsonb)
                    """,
                    run["workspace_id"],
                    claim["id"],
                    document_id,
                    matched_block["id"],
                    matched_block["page_no"],
                    cite_quote,
                    orjson.dumps({"precision": precision}).decode(),
                )

            for rel in relations:
                src_id = entity_id_map.get(rel["source_title"])
                tgt_id = entity_id_map.get(rel["target_title"])
                if src_id and tgt_id:
                    existing_rel = await connection.fetchrow(
                        """
                        SELECT id::text AS id, metadata
                        FROM relations
                        WHERE workspace_id = $1::uuid
                          AND source_entity_id = $2::uuid
                          AND target_entity_id = $3::uuid
                          AND relation_type = $4
                        LIMIT 1
                        """,
                        run["workspace_id"],
                        src_id,
                        tgt_id,
                        rel["relation_type"],
                    )
                    if existing_rel:
                        meta = existing_rel["metadata"] if isinstance(existing_rel["metadata"], dict) else {}
                        src_ids = meta.get("source_document_ids", [])
                        if document_id not in src_ids:
                            src_ids.append(document_id)
                            meta["source_document_ids"] = src_ids
                            await connection.execute(
                                "UPDATE relations SET metadata = $2::jsonb WHERE id = $1::uuid",
                                existing_rel["id"],
                                orjson.dumps(meta).decode(),
                            )
                    else:
                        await connection.execute(
                            """
                            INSERT INTO relations (workspace_id, source_entity_id, target_entity_id, relation_type, metadata)
                            VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::jsonb)
                            """,
                            run["workspace_id"],
                            src_id,
                            tgt_id,
                            rel["relation_type"],
                            orjson.dumps({"source": "compiler", "source_document_ids": [document_id]}).decode(),
                        )

            for action in plan.actions:
                target_doc_id = await _append_or_replace_document(
                    connection,
                    run["workspace_id"],
                    run_id,
                    run["actor_id"] or "compiler-worker",
                    action,
                )
                await connection.execute(
                    """
                    INSERT INTO document_references (workspace_id, source_document_id, target_document_id, ref_type, metadata)
                    VALUES ($1::uuid, $2::uuid, $3::uuid, 'compiled_from', $4::jsonb)
                    ON CONFLICT (source_document_id, target_document_id, ref_type)
                    DO UPDATE SET metadata = EXCLUDED.metadata
                    """,
                    run["workspace_id"],
                    document_id,
                    target_doc_id,
                    orjson.dumps({"run_id": run_id, "path": action.path}).decode(),
                )

            source_count = await connection.fetchval(
                "SELECT COUNT(*) FROM documents WHERE workspace_id = $1::uuid AND kind = 'source' AND archived_at IS NULL",
                run["workspace_id"],
            )
            wiki_count = await connection.fetchval(
                "SELECT COUNT(*) FROM documents WHERE workspace_id = $1::uuid AND kind IN ('wiki', 'system') AND archived_at IS NULL",
                run["workspace_id"],
            )
            overview_content = f"""This workspace is an agent-native compiled knowledge vault.

## Key Findings

| Signal | Value |
| --- | --- |
| Sources | {source_count} |
| Wiki Pages | {wiki_count} |
| Latest Source | {source_document['title']} |

```mermaid
graph TD
    {_mermaid_node(f"source-{_slugify(source_document['title'])}", source_document['title'])} --> {_mermaid_node("compiler", "Compiler")}
    {_mermaid_node("compiler", "Compiler")} --> {_mermaid_node("compiled-wiki", "Compiled Wiki")}
    {_mermaid_node("compiled-wiki", "Compiled Wiki")} --> {_mermaid_node("hybrid-search", "Hybrid Search")}
    {_mermaid_node("compiled-wiki", "Compiled Wiki")} --> {_mermaid_node("agent-plane", "Agent Operating Plane")}
```

## Recent Updates

- Processed source `{source_document['title']}`.
- Extracted {len(entities)} semantic nodes.
- Created or updated {len(plan.actions) - 1} wiki documents.
"""
            await _append_or_replace_document(
                connection,
                run["workspace_id"],
                run_id,
                run["actor_id"] or "compiler-worker",
                ChangeAction(
                    op="replace_section",
                    path="/wiki/overview.md",
                    title="Overview",
                    content=overview_content,
                    reason="Refresh overview after ingest",
                ),
            )
            await connection.execute(
                """
                UPDATE documents
                SET status = 'ready'
                WHERE id = $1::uuid
                """,
                document_id,
            )
            await update_run(
                connection,
                run_id,
                status="succeeded",
                output_payload={
                    "pages": len(parsed.pages),
                    "blocks": len(blocks),
                    "entities": len(entities),
                    "claims": len(claims),
                    "relations": len(relations),
                    "change_plan": [asdict(action) for action in plan.actions],
                },
                completed_now=True,
            )
    await _record_step(run_id, workspace_id, "compile", "succeeded", {"summary": plan.summary})
    await record_activity(
        workspace_id=run["workspace_id"],
        actor_type="system",
        actor_id="compiler-worker",
        event_type="run.succeeded",
        payload={"summary": plan.summary, "entity_count": len(entities), "claim_count": len(claims), "relation_count": len(relations), "change_count": len(plan.actions)},
        run_id=run_id,
        document_id=document_id,
    )
    await publish_event(
        f"workspace:{run['workspace_id']}",
        {"type": "run.completed", "payload": {"run_id": run_id, "status": "succeeded"}},
    )
