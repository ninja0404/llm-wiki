from __future__ import annotations

import asyncio
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel


app = FastAPI(title="LLM Wiki Converter Service", version="0.1.0")

ALLOWED_EXTENSIONS = {"docx", "doc", "pptx", "ppt", "odt", "odp"}


class ConvertRequest(BaseModel):
    source_url: str
    upload_url: str
    source_ext: str


def _validate_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise HTTPException(status_code=400, detail="Only http/https URLs are supported")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/convert")
async def convert(request: ConvertRequest) -> dict:
    if request.source_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported source extension")
    _validate_url(request.source_url)
    _validate_url(request.upload_url)

    with tempfile.TemporaryDirectory() as temp_dir:
        source_path = Path(temp_dir) / f"source.{request.source_ext}"
        async with httpx.AsyncClient(timeout=120.0) as client:
            source_response = await client.get(request.source_url)
            source_response.raise_for_status()
            await asyncio.to_thread(source_path.write_bytes, source_response.content)

        result = await asyncio.to_thread(
            subprocess.run,
            [
                "libreoffice",
                "--headless",
                "--norestore",
                "--convert-to",
                "pdf",
                "--outdir",
                temp_dir,
                str(source_path),
            ],
            capture_output=True,
            timeout=120,
            check=False,
        )
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=result.stderr.decode("utf-8", errors="replace")[:500])

        pdf_path = Path(temp_dir) / "source.pdf"
        if not pdf_path.exists():
            raise HTTPException(status_code=500, detail="LibreOffice did not emit a PDF")

        async with httpx.AsyncClient(timeout=120.0) as client:
            upload_response = await client.put(
                request.upload_url,
                content=pdf_path.read_bytes(),
                headers={"Content-Type": "application/pdf"},
            )
            upload_response.raise_for_status()

    return {"status": "ok"}
