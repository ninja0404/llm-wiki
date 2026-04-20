from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass

from openai import AsyncOpenAI

from .metrics import LLM_CALLS_TOTAL, LLM_DURATION
from .tracing import traced_span

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class LLMConfig:
    provider: str
    model: str
    api_key: str
    base_url: str | None = None


def _extract_json(text: str) -> dict | list | None:
    """Extract JSON from LLM response, handling markdown code fences."""
    fence = re.search(r"```(?:json)?\s*\n(.*?)```", text, re.DOTALL)
    raw = fence.group(1) if fence else text
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


async def _call_openai_compatible(config: LLMConfig, system: str, prompt: str, timeout_seconds: int) -> str:
    kwargs: dict = {"api_key": config.api_key}
    if config.base_url:
        kwargs["base_url"] = config.base_url
    client = AsyncOpenAI(**kwargs)
    try:
        response = await client.chat.completions.create(
            model=config.model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
            timeout=timeout_seconds,
        )
        return response.choices[0].message.content or ""
    finally:
        await client.close()


async def _call_anthropic(config: LLMConfig, system: str, prompt: str, timeout_seconds: int) -> str:
    from anthropic import AsyncAnthropic

    client = AsyncAnthropic(api_key=config.api_key)
    try:
        response = await client.messages.create(
            model=config.model,
            max_tokens=4096,
            system=system,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            timeout=timeout_seconds,
        )
        return response.content[0].text if response.content else ""
    finally:
        await client.close()


async def invoke_structured(
    system: str,
    prompt: str,
    config: LLMConfig,
    timeout_seconds: int = 120,
) -> dict | list | None:
    """Call LLM and parse structured JSON output. Config is required."""
    if not config.api_key:
        raise RuntimeError(f"LLM API key not configured for provider '{config.provider}'")

    import time

    start = time.perf_counter()
    try:
        with traced_span(
            "llm.invoke",
            tracer_name="llm",
            attributes={
                "llm.provider": config.provider,
                "llm.model": config.model,
                "llm.timeout_seconds": timeout_seconds,
            },
        ):
            if config.provider == "anthropic":
                text = await _call_anthropic(config, system, prompt, timeout_seconds)
            else:
                text = await _call_openai_compatible(config, system, prompt, timeout_seconds)
        LLM_CALLS_TOTAL.labels(provider=config.provider, model=config.model, status="succeeded").inc()
        LLM_DURATION.labels(provider=config.provider, model=config.model).observe(time.perf_counter() - start)
        return _extract_json(text)
    except RuntimeError:
        LLM_CALLS_TOTAL.labels(provider=config.provider, model=config.model, status="failed").inc()
        LLM_DURATION.labels(provider=config.provider, model=config.model).observe(time.perf_counter() - start)
        raise
    except Exception as exc:
        LLM_CALLS_TOTAL.labels(provider=config.provider, model=config.model, status="failed").inc()
        LLM_DURATION.labels(provider=config.provider, model=config.model).observe(time.perf_counter() - start)
        logger.exception("LLM invocation failed (provider=%s, model=%s)", config.provider, config.model)
        raise RuntimeError(f"LLM call failed ({config.provider}/{config.model}): {exc}") from exc
