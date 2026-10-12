from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass
class Book:
    id: str
    title: str
    detail_url: str
    category: str
    categories: list[str] = field(default_factory=list)
    author: str = ""
    status: str = ""
    formats: list[str] = field(default_factory=list)
    translation_type: str = "UNKNOWN"
    ai_edited: bool = False
    translator: str = ""
    editor: str = ""
    source: str = ""
    views: int = 0
    tags: list[str] = field(default_factory=list)
    description: str = ""
    epub_url: str = ""
    epub_variants: list[dict] = field(default_factory=list)
    download_status: str = "PENDING"
    file_path: str = ""
    file_size: int = 0
    error: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, raw: dict) -> "Book":
        fields = cls.__dataclass_fields__
        return cls(**{key: value for key, value in raw.items() if key in fields})
