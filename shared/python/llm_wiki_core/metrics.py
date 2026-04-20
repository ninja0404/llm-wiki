"""Prometheus metrics for LLM Wiki services.

Usage:
    from llm_wiki_core.metrics import REQUEST_COUNT, REQUEST_LATENCY, ...
    Expose via /metrics endpoint using make_metrics_response().
"""

from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram, generate_latest


REQUEST_COUNT = Counter(
    "llmwiki_http_requests_total",
    "Total HTTP requests",
    ["method", "path_template", "status_code"],
)

REQUEST_LATENCY = Histogram(
    "llmwiki_http_request_duration_seconds",
    "HTTP request latency in seconds",
    ["method", "path_template"],
    buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)

ACTIVE_REQUESTS = Gauge(
    "llmwiki_http_active_requests",
    "Number of in-flight HTTP requests",
)

QUEUE_DEPTH = Gauge(
    "llmwiki_queue_depth",
    "Number of pending messages in the run queue stream",
)

QUEUE_DLQ_DEPTH = Gauge(
    "llmwiki_queue_dlq_depth",
    "Number of messages in the dead letter queue",
)

QUEUE_RECLAIMS_TOTAL = Counter(
    "llmwiki_queue_reclaims_total",
    "Total pending queue messages reclaimed by a worker",
)

QUEUE_DLQ_TOTAL = Counter(
    "llmwiki_queue_dlq_total",
    "Total queue messages moved to the dead letter queue",
)

QUEUE_REPLAYS_TOTAL = Counter(
    "llmwiki_queue_replays_total",
    "Total DLQ messages replayed to the main stream",
)

QUEUE_RETRIES_TOTAL = Counter(
    "llmwiki_queue_retries_total",
    "Total queue messages rescheduled for retry after processing failure",
)

RUN_LOCK_CONFLICTS_TOTAL = Counter(
    "llmwiki_run_lock_conflicts_total",
    "Total times a worker could not acquire a run lock",
)

RUN_DURATION = Histogram(
    "llmwiki_run_duration_seconds",
    "Compiler run processing time",
    ["status"],
    buckets=(1.0, 5.0, 15.0, 30.0, 60.0, 120.0, 300.0),
)

RUN_TOTAL = Counter(
    "llmwiki_runs_total",
    "Total compiler runs processed",
    ["status"],
)

ACTIVE_RUNS = Gauge(
    "llmwiki_active_runs",
    "Number of currently processing runs",
)

LLM_CALLS_TOTAL = Counter(
    "llmwiki_llm_calls_total",
    "Total LLM calls",
    ["provider", "model", "status"],
)

LLM_DURATION = Histogram(
    "llmwiki_llm_duration_seconds",
    "LLM call duration in seconds",
    ["provider", "model"],
    buckets=(0.1, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0, 120.0),
)

EMBEDDING_CALLS_TOTAL = Counter(
    "llmwiki_embedding_calls_total",
    "Total embedding calls",
    ["model", "status"],
)

EMBEDDING_DURATION = Histogram(
    "llmwiki_embedding_duration_seconds",
    "Embedding call duration in seconds",
    ["model"],
    buckets=(0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0),
)

CONVERTER_CALLS_TOTAL = Counter(
    "llmwiki_converter_calls_total",
    "Total converter calls",
    ["source_ext", "status"],
)

CONVERTER_DURATION = Histogram(
    "llmwiki_converter_duration_seconds",
    "Converter call duration in seconds",
    ["source_ext"],
    buckets=(0.1, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0),
)

CONVERTER_SOURCE_BYTES = Histogram(
    "llmwiki_converter_source_bytes",
    "Source object size processed by converter",
    ["source_ext"],
    buckets=(1024, 10 * 1024, 100 * 1024, 1024 * 1024, 10 * 1024 * 1024, 100 * 1024 * 1024, 250 * 1024 * 1024),
)


def make_metrics_response() -> bytes:
    return generate_latest()
