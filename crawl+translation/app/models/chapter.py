from dataclasses import dataclass


@dataclass
class Chapter:
    index: int
    title: str
    url: str
    content: str | None = None

