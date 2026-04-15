from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class ReplaceResult:
    content: str
    occurrences: int


def replace_exact_once(content: str, old_text: str, new_text: str) -> ReplaceResult:
    occurrences = content.count(old_text)
    if occurrences != 1:
        return ReplaceResult(content=content, occurrences=occurrences)
    return ReplaceResult(content=content.replace(old_text, new_text, 1), occurrences=1)


def append_markdown(content: str, appendix: str) -> str:
    if not content.strip():
        return appendix.strip()
    return f"{content.rstrip()}\n\n{appendix.strip()}"


def extract_sections(content: str, section_names: list[str]) -> str:
    if not section_names:
        return content
    normalized = {name.lower() for name in section_names}
    chunks: list[str] = []
    current_title: str | None = None
    current_lines: list[str] = []

    for line in content.splitlines():
        if line.startswith("#"):
            if current_title and current_title.lower() in normalized:
                chunks.append("\n".join(current_lines).strip())
            current_title = line.lstrip("#").strip()
            current_lines = [line]
            continue
        if current_title is not None:
            current_lines.append(line)

    if current_title and current_title.lower() in normalized:
        chunks.append("\n".join(current_lines).strip())

    return "\n\n".join(chunk for chunk in chunks if chunk)
