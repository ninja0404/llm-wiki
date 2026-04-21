"""Notion adapter — pulls pages from a Notion database and converts
them into ``ParsedDocument`` objects for the existing ingest pipeline.

Usage:
    adapter = NotionAdapter(api_key="secret_xxx")
    pages = await adapter.fetch_database(database_id)
    for page in pages:
        parsed = adapter.to_parsed_document(page)
        # feed parsed into IngestService / process_run …
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from llm_wiki_core.parsing import ParsedDocument, ParsedPage

logger = logging.getLogger(__name__)

NOTION_API_VERSION = "2022-06-28"
NOTION_BASE_URL = "https://api.notion.com/v1"


@dataclass(slots=True)
class NotionPage:
    page_id: str
    title: str
    url: str
    blocks_md: str


class NotionAdapter:
    def __init__(self, api_key: str, timeout: float = 30.0) -> None:
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Notion-Version": NOTION_API_VERSION,
            "Content-Type": "application/json",
        }
        self._client = httpx.AsyncClient(timeout=timeout, headers=self._headers)

    async def fetch_database(self, database_id: str, page_size: int = 100) -> list[NotionPage]:
        """Query all pages in a Notion database."""
        pages: list[NotionPage] = []
        url = f"{NOTION_BASE_URL}/databases/{database_id}/query"
        has_more = True
        start_cursor: str | None = None

        while has_more:
            body: dict = {"page_size": page_size}
            if start_cursor:
                body["start_cursor"] = start_cursor

            resp = await self._client.post(url, json=body)
            resp.raise_for_status()
            data = resp.json()

            for result in data.get("results", []):
                page_id = result["id"]
                title = _extract_title(result)
                page_url = result.get("url", "")
                blocks_md = await self._fetch_page_blocks(page_id)
                pages.append(NotionPage(page_id=page_id, title=title, url=page_url, blocks_md=blocks_md))

            has_more = data.get("has_more", False)
            start_cursor = data.get("next_cursor")

        logger.info("fetched %d pages from Notion database %s", len(pages), database_id)
        return pages

    async def fetch_page(self, page_id: str) -> NotionPage:
        resp = await self._client.get(f"{NOTION_BASE_URL}/pages/{page_id}")
        resp.raise_for_status()
        result = resp.json()
        title = _extract_title(result)
        blocks_md = await self._fetch_page_blocks(page_id)
        return NotionPage(page_id=page_id, title=title, url=result.get("url", ""), blocks_md=blocks_md)

    async def _fetch_page_blocks(self, page_id: str) -> str:
        """Retrieve all block children and convert to markdown."""
        blocks: list[str] = []
        url = f"{NOTION_BASE_URL}/blocks/{page_id}/children"
        has_more = True
        start_cursor: str | None = None

        while has_more:
            params: dict = {"page_size": 100}
            if start_cursor:
                params["start_cursor"] = start_cursor

            resp = await self._client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()

            for block in data.get("results", []):
                md = _block_to_markdown(block)
                if md:
                    blocks.append(md)

            has_more = data.get("has_more", False)
            start_cursor = data.get("next_cursor")

        return "\n\n".join(blocks)

    def to_parsed_document(self, page: NotionPage) -> ParsedDocument:
        return ParsedDocument(
            title=page.title,
            mime_type="text/markdown",
            pages=[ParsedPage(page_no=1, text_md=page.blocks_md)],
        )

    async def close(self) -> None:
        await self._client.aclose()


def _extract_title(page_obj: dict) -> str:
    props = page_obj.get("properties", {})
    for prop in props.values():
        if prop.get("type") == "title":
            parts = prop.get("title", [])
            return "".join(p.get("plain_text", "") for p in parts)
    return "Untitled"


def _rich_text_to_str(rich_texts: list[dict]) -> str:
    return "".join(rt.get("plain_text", "") for rt in rich_texts)


def _block_to_markdown(block: dict) -> str:
    btype = block.get("type", "")
    data = block.get(btype, {})

    if btype == "paragraph":
        return _rich_text_to_str(data.get("rich_text", []))
    if btype.startswith("heading_"):
        level = int(btype[-1]) if btype[-1].isdigit() else 1
        text = _rich_text_to_str(data.get("rich_text", []))
        return f"{'#' * level} {text}"
    if btype == "bulleted_list_item":
        return f"- {_rich_text_to_str(data.get('rich_text', []))}"
    if btype == "numbered_list_item":
        return f"1. {_rich_text_to_str(data.get('rich_text', []))}"
    if btype == "to_do":
        checked = "x" if data.get("checked") else " "
        return f"- [{checked}] {_rich_text_to_str(data.get('rich_text', []))}"
    if btype == "toggle":
        return f"<details><summary>{_rich_text_to_str(data.get('rich_text', []))}</summary></details>"
    if btype == "code":
        lang = data.get("language", "")
        code = _rich_text_to_str(data.get("rich_text", []))
        return f"```{lang}\n{code}\n```"
    if btype == "quote":
        return f"> {_rich_text_to_str(data.get('rich_text', []))}"
    if btype == "callout":
        icon = data.get("icon", {}).get("emoji", "")
        text = _rich_text_to_str(data.get("rich_text", []))
        return f"> {icon} {text}"
    if btype == "divider":
        return "---"
    if btype == "table_of_contents":
        return ""
    if btype == "image":
        url = data.get("file", {}).get("url") or data.get("external", {}).get("url", "")
        caption = _rich_text_to_str(data.get("caption", []))
        return f"![{caption}]({url})" if url else ""

    return ""
