from __future__ import annotations

from pathlib import Path
from typing import Any

from httpx import ASGITransport, AsyncClient

from services.converter_service.app.main import app


async def test_converter_object_key_flow(monkeypatch) -> None:
    stored: dict[str, bytes] = {"ws/source.docx": b"fake-docx"}
    uploads: dict[str, tuple[bytes, str]] = {}

    def fake_get_bytes(key: str) -> bytes:
        return stored[key]

    def fake_put_bytes(key: str, data: bytes, content_type: str) -> None:
        uploads[key] = (data, content_type)

    def fake_run(*args: Any, **kwargs: Any):
        command = args[0]
        outdir = command[command.index("--outdir") + 1]
        pdf_path = Path(outdir) / "source.pdf"
        pdf_path.write_bytes(b"%PDF-1.7\nfake\n")

        class Result:
            returncode = 0
            stderr = b""

        return Result()

    monkeypatch.setattr("services.converter_service.app.main.get_bytes", fake_get_bytes)
    monkeypatch.setattr("services.converter_service.app.main.put_bytes", fake_put_bytes)
    monkeypatch.setattr("services.converter_service.app.main.subprocess.run", fake_run)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/convert",
            headers={"Authorization": "Bearer 0123456789abcdef0123456789abcdef"},
            json={
                "source_object_key": "ws/source.docx",
                "target_object_key": "ws/converted/source.pdf",
                "source_ext": "docx",
            },
        )

    assert response.status_code == 200
    assert uploads["ws/converted/source.pdf"][0].startswith(b"%PDF-1.7")
    assert uploads["ws/converted/source.pdf"][1] == "application/pdf"
