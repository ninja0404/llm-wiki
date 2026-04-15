from __future__ import annotations

import csv
import io
import mimetypes
from dataclasses import dataclass

from bs4 import BeautifulSoup
from docx import Document as DocxDocument
from openpyxl import load_workbook
from pypdf import PdfReader


@dataclass(slots=True)
class ParsedPage:
    page_no: int
    text_md: str
    elements: dict


@dataclass(slots=True)
class ParsedDocument:
    title: str
    mime_type: str
    pages: list[ParsedPage]


def detect_mime_type(filename: str, fallback: str = "application/octet-stream") -> str:
    mime_type, _ = mimetypes.guess_type(filename)
    return mime_type or fallback


def parse_document(filename: str, data: bytes, mime_type: str | None = None) -> ParsedDocument:
    effective_mime = mime_type or detect_mime_type(filename)
    suffix = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""

    if suffix in {"md", "txt"}:
        text = data.decode("utf-8", errors="replace")
        return ParsedDocument(title=filename.rsplit(".", 1)[0], mime_type=effective_mime, pages=[ParsedPage(page_no=1, text_md=text, elements={})])

    if suffix in {"html", "htm"}:
        soup = BeautifulSoup(data.decode("utf-8", errors="replace"), "html.parser")
        text = soup.get_text("\n").strip()
        return ParsedDocument(title=filename.rsplit(".", 1)[0], mime_type=effective_mime, pages=[ParsedPage(page_no=1, text_md=text, elements={})])

    if suffix == "pdf":
        reader = PdfReader(io.BytesIO(data))
        pages = [
            ParsedPage(page_no=index + 1, text_md=(page.extract_text() or "").strip(), elements={})
            for index, page in enumerate(reader.pages)
        ]
        return ParsedDocument(title=filename.rsplit(".", 1)[0], mime_type=effective_mime, pages=pages or [ParsedPage(page_no=1, text_md="", elements={})])

    if suffix == "docx":
        document = DocxDocument(io.BytesIO(data))
        paragraphs = "\n".join(paragraph.text for paragraph in document.paragraphs if paragraph.text.strip())
        return ParsedDocument(title=filename.rsplit(".", 1)[0], mime_type=effective_mime, pages=[ParsedPage(page_no=1, text_md=paragraphs, elements={})])

    if suffix in {"xlsx", "xlsm", "xltx", "xltm", "xls"}:
        workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        pages: list[ParsedPage] = []
        for index, sheet_name in enumerate(workbook.sheetnames, start=1):
            sheet = workbook[sheet_name]
            rows = [
                ["" if cell is None else str(cell) for cell in row]
                for row in sheet.iter_rows(values_only=True)
            ]
            if not rows:
                rows = [["(empty)"]]
            markdown_rows = ["| " + " | ".join(row) + " |" for row in rows[:101]]
            separator = "| " + " | ".join("---" for _ in rows[0]) + " |"
            body = "\n".join(markdown_rows[1:]) if len(markdown_rows) > 1 else ""
            table = "\n".join([markdown_rows[0], separator, body]).strip()
            pages.append(ParsedPage(page_no=index, text_md=f"## {sheet_name}\n\n{table}", elements={"sheet_name": sheet_name}))
        workbook.close()
        return ParsedDocument(title=filename.rsplit(".", 1)[0], mime_type=effective_mime, pages=pages)

    if suffix == "csv":
        rows = list(csv.reader(io.StringIO(data.decode("utf-8", errors="replace"))))
        if not rows:
            rows = [["(empty)"]]
        markdown_rows = ["| " + " | ".join(row) + " |" for row in rows[:101]]
        separator = "| " + " | ".join("---" for _ in rows[0]) + " |"
        body = "\n".join(markdown_rows[1:]) if len(markdown_rows) > 1 else ""
        table = "\n".join([markdown_rows[0], separator, body]).strip()
        return ParsedDocument(title=filename.rsplit(".", 1)[0], mime_type=effective_mime, pages=[ParsedPage(page_no=1, text_md=table, elements={"sheet_name": "Sheet1"})])

    text = data.decode("utf-8", errors="replace")
    return ParsedDocument(title=filename.rsplit(".", 1)[0], mime_type=effective_mime, pages=[ParsedPage(page_no=1, text_md=text, elements={})])
