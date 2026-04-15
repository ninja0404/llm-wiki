from llm_wiki_core.parsing import parse_document


def test_parse_markdown_document() -> None:
    parsed = parse_document("notes.md", b"# Title\n\nBody")
    assert parsed.title == "notes"
    assert len(parsed.pages) == 1
    assert "Body" in parsed.pages[0].text_md


def test_parse_html_document() -> None:
    parsed = parse_document("page.html", b"<html><body><h1>Alpha</h1><p>Beta</p></body></html>")
    assert parsed.pages[0].text_md
    assert "Alpha" in parsed.pages[0].text_md


def test_parse_csv_document() -> None:
    parsed = parse_document("table.csv", b"col1,col2\n1,2\n3,4\n")
    assert len(parsed.pages) == 1
    assert "| col1 | col2 |" in parsed.pages[0].text_md
