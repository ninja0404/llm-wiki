from llm_wiki_core.diffing import build_line_diff


def test_build_line_diff_reports_changes() -> None:
    diff = build_line_diff("alpha\nbeta\ngamma", "alpha\nbeta-2\ngamma\ndelta")
    assert diff["stats"]["added"] == 2
    assert diff["stats"]["removed"] == 1
    assert any(line["type"] == "added" and line["text"] == "delta" for line in diff["lines"])
    assert any(line["type"] == "removed" and line["text"] == "beta" for line in diff["lines"])
