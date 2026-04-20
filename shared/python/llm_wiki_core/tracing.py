"""OpenTelemetry tracing configuration.

Call configure_tracing() once at process startup.
Set OTEL_EXPORTER_OTLP_ENDPOINT env var to send traces (e.g. http://localhost:4317).
When the endpoint is unset, traces are discarded silently.
"""

from __future__ import annotations

import os
from contextlib import contextmanager

from opentelemetry import trace
from opentelemetry.propagate import extract, inject
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter


def configure_tracing(service_name: str = "llm-wiki") -> None:
    resource = Resource.create({"service.name": service_name})
    provider = TracerProvider(resource=resource)

    otlp_endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")
    if otlp_endpoint:
        try:
            from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

            exporter = OTLPSpanExporter(endpoint=otlp_endpoint, insecure=True)
            provider.add_span_processor(BatchSpanProcessor(exporter))
        except ImportError:
            provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
    elif os.environ.get("OTEL_TRACE_CONSOLE") == "1":
        provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))

    trace.set_tracer_provider(provider)


def get_tracer(name: str = "llm-wiki") -> trace.Tracer:
    return trace.get_tracer(name)


def inject_trace_headers(carrier: dict[str, str] | None = None) -> dict[str, str]:
    headers = carrier or {}
    inject(headers)
    return headers


def extract_trace_context(carrier: dict[str, str] | None):
    return extract(carrier or {})


@contextmanager
def traced_span(name: str, *, tracer_name: str = "llm-wiki", attributes: dict[str, object] | None = None, context=None):
    tracer = get_tracer(tracer_name)
    with tracer.start_as_current_span(name, attributes=attributes or {}, context=context) as span:
        yield span
