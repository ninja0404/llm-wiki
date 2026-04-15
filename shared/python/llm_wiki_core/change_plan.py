from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class ChangeAction:
    op: str
    path: str
    title: str
    content: str
    reason: str


@dataclass(slots=True)
class ChangePlan:
    actions: list[ChangeAction] = field(default_factory=list)
    summary: str = ""
