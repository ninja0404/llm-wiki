from __future__ import annotations

from difflib import SequenceMatcher


def build_line_diff(previous: str, current: str) -> dict:
    before = previous.splitlines()
    after = current.splitlines()
    matcher = SequenceMatcher(a=before, b=after)

    lines: list[dict[str, str]] = []
    added = 0
    removed = 0

    for opcode, i1, i2, j1, j2 in matcher.get_opcodes():
        if opcode == "equal":
            for line in before[i1:i2]:
                lines.append({"type": "context", "text": line})
            continue
        if opcode in {"replace", "delete"}:
            for line in before[i1:i2]:
                removed += 1
                lines.append({"type": "removed", "text": line})
        if opcode in {"replace", "insert"}:
            for line in after[j1:j2]:
                added += 1
                lines.append({"type": "added", "text": line})

    return {
        "stats": {
            "added": added,
            "removed": removed,
            "before_lines": len(before),
            "after_lines": len(after),
        },
        "lines": lines,
    }
