from llm_wiki_core.markdown_ops import append_markdown, extract_sections, replace_exact_once


def test_replace_exact_once_success() -> None:
    result = replace_exact_once("hello world", "world", "vault")
    assert result.occurrences == 1
    assert result.content == "hello vault"


def test_replace_exact_once_multiple_matches() -> None:
    result = replace_exact_once("same same", "same", "new")
    assert result.occurrences == 2
    assert result.content == "same same"


def test_append_markdown() -> None:
    assert append_markdown("## Intro", "## More") == "## Intro\n\n## More"


def test_extract_sections() -> None:
    content = "# Intro\nhello\n## Evidence\nfact\n## Appendix\nextra"
    extracted = extract_sections(content, ["Evidence"])
    assert "## Evidence" in extracted
    assert "fact" in extracted
    assert "Appendix" not in extracted
