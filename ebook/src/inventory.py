"""Disk-backed EPUB inventory shared by all category runs."""

from __future__ import annotations

import json
import tempfile
import zipfile
from pathlib import Path

from .downloader import validate_epub
from .models import Book
from .selection import PRIORITY, title_key
from .storage import Storage, _replace_with_retry
from .utils import fold

FOLDER_TYPES = {"Dịch": "HUMAN", "AI": "AI", "CV": "CONVERT"}


def _part(relative: Path) -> str:
    folders = set(relative.parts[:-1])
    if "50_ChuongDau" in folders:
        return "first_50"
    if "Con_Lai" in folders:
        return "remainder"
    return "full"


def _identity(title: str, author: str) -> tuple[str, str]:
    return title_key(title), fold(author)


class EpubInventory:
    def __init__(self, downloads: Path, storage: Storage) -> None:
        self.downloads = downloads.resolve()
        self.path = self.downloads / "danh_sach_epub.json"
        self.storage = storage
        self.files: list[dict] = []
        self.rebuild()

    def _entry(self, path: Path, book: Book | None = None) -> dict:
        relative = path.relative_to(self.downloads)
        stem = path.stem
        title, author = stem.rsplit(" - ", 1) if " - " in stem else (stem, "")
        kind = next((FOLDER_TYPES[part] for part in relative.parts if part in FOLDER_TYPES), "UNKNOWN")
        return {
            "name": path.name,
            "relative_path": relative.as_posix(),
            "category": relative.parts[0],
            "part": _part(relative),
            "title": book.title if book else title,
            "author": book.author if book else author,
            "translation_type": book.translation_type if book else kind,
            "size_bytes": path.stat().st_size,
        }

    def rebuild(self) -> None:
        """The filesystem is authoritative; refresh JSON before any downloads."""
        self.downloads.mkdir(parents=True, exist_ok=True)
        by_path = {
            (self.storage.root / book.file_path).resolve(): book
            for book in self.storage.books.values() if book.file_path and book.download_status == "SUCCESS"
        }
        self.files = [
            self._entry(path, by_path.get(path.resolve()))
            for path in sorted(self.downloads.rglob("*.epub")) if path.is_file()
        ]
        self.save()

    def save(self) -> None:
        payload = {"total_epubs": len(self.files), "files": self.files}
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=self.downloads, prefix=".danh_sach_epub-",
            suffix=".tmp", delete=False,
        ) as stream:
            temporary = Path(stream.name)
            json.dump(payload, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        _replace_with_retry(temporary, self.path)

    def matches(self, book: Book) -> list[dict]:
        key = _identity(book.title, book.author)
        return [
            entry for entry in self.files
            if entry["part"] == "full"
            and _identity(entry["title"], entry["author"]) == key
            and (self.downloads / entry["relative_path"]).is_file()
        ]

    def best_existing(self, book: Book, *, category: str | None = None) -> dict | None:
        matches = sorted(
            (item for item in self.matches(book) if category is None or item["category"] == category),
            key=lambda item: PRIORITY.get(item["translation_type"], 0), reverse=True,
        )
        for entry in matches:
            try:
                validate_epub(self.downloads / entry["relative_path"])
            except (OSError, ValueError, zipfile.BadZipFile):
                continue
            return entry
        return None

    def add(self, book: Book, path: Path) -> None:
        relative = path.resolve().relative_to(self.downloads)
        self.files = [item for item in self.files if item["relative_path"] != relative.as_posix()]
        self.files.append(self._entry(path, book))
        self.files.sort(key=lambda item: item["relative_path"].casefold())
        self.save()

    def remove(self, path: Path) -> None:
        relative = path.resolve().relative_to(self.downloads).as_posix()
        self.files = [item for item in self.files if item["relative_path"] != relative]
        self.save()
