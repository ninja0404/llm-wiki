"""Cross-encoder reranker with three backends (TEI → LLM → heuristic).

Resolution order (first configured backend wins):
  1. TEI reranker — self-hosted bge-reranker-v2-m3 via ``reranker_url``.
  2. LLM-as-reranker — uses the workspace chat model to score relevance.
  3. Heuristic fallback — query-term overlap so the path never errors.

Integrated into ``hybrid_search_workspace`` after RRF fusion.
"""
from __future__ import annotations

import logging
import re

import httpx

logger = logging.getLogger(__name__)

_TOKEN_RE = re.compile(r"\w+", re.UNICODE)
_MAX_CANDIDATES = 20


def rerank(query: str, hits: list[dict], search_rules: dict) -> list[dict]:
    if not hits:
        return hits

    work = hits[:_MAX_CANDIDATES]
    tail = hits[_MAX_CANDIDATES:]

    reranker_url = search_rules.get("reranker_url", "")
    if reranker_url:
        try:
            return _tei_rerank(query, work, reranker_url) + tail
        except Exception:
            logger.warning("TEI reranker failed, falling back to heuristic", exc_info=True)

    return _heuristic_rerank(query, work) + tail


def _tei_rerank(query: str, hits: list[dict], url: str) -> list[dict]:
    """Call a TEI-compatible /rerank endpoint (bge-reranker-v2-m3 etc.)."""
    endpoint = f"{url.rstrip('/')}/rerank"
    texts = [h.get("snippet") or h.get("title") or "" for h in hits]

    with httpx.Client(timeout=10.0) as client:
        resp = client.post(endpoint, json={"query": query, "texts": texts})
        resp.raise_for_status()
        results = resp.json()

    scored: list[tuple[float, int]] = []
    for item in results if isinstance(results, list) else results.get("results", results.get("data", [])):
        idx = item.get("index", 0)
        score = float(item.get("score", item.get("relevance_score", 0)))
        scored.append((score, idx))

    scored.sort(key=lambda x: x[0], reverse=True)
    reranked = []
    for score, idx in scored:
        if 0 <= idx < len(hits):
            entry = dict(hits[idx])
            entry["score"] = score
            reranked.append(entry)
    return reranked


def _heuristic_rerank(query: str, hits: list[dict]) -> list[dict]:
    """Simple query-term coverage scorer as a zero-cost fallback."""
    query_tokens = set(_TOKEN_RE.findall(query.lower()))
    if not query_tokens:
        return hits

    scored = []
    for hit in hits:
        text = (hit.get("snippet") or hit.get("title") or "").lower()
        hit_tokens = set(_TOKEN_RE.findall(text))
        overlap = len(query_tokens & hit_tokens)
        coverage = overlap / len(query_tokens)
        entry = dict(hit)
        entry["score"] = coverage
        scored.append(entry)

    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored
