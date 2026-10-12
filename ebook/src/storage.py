from __future__ import annotations

import csv
import json
import os
import tempfile
import time
import zipfile
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .downloader import validate_epub
from .models import Book

CSV_FIELDS = [
    "id", "title", "author", "category", "categories", "status", "formats",
    "translation_type", "ai_edited", "translator", "editor", "source", "views",
    "tags", "description", "detail_url", "epub_url", "epub_variants",
    "download_status", "file_path", "file_size", "error",
]


def drive_file_id(url: str) -> str:
    parsed = urlparse(url)
    if parsed.hostname not in {"docs.google.com", "drive.google.com", "drive.usercontent.google.com"}:
        return ""
    return parse_qs(parsed.query).get("id", [""])[0]


def _replace_with_retry(source: str | Path, destination: Path) -> None:
    """Windows readers can briefly lock a CSV during an atomic replacement."""
    for attempt in range(10):
        try:
            os.replace(source, destination)
            return
        except PermissionError:
            if attempt == 9:
                raise
            time.sleep(0.1 * (attempt + 1))


class Storage:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.csv_path = root / "data" / "books.csv"
        self.books: dict[str, Book] = {}
        if self.csv_path.exists():
            with self.csv_path.open("r", encoding="utf-8-sig", newline="") as stream:
                for row in csv.DictReader(stream):
                    row["categories"] = [s for s in row.get("categories", "").split(" | ") if s]
                    row["formats"] = [s for s in row.get("formats", "").split(" | ") if s]
                    for field in ("tags",):
                        row[field] = [s for s in row.get(field, "").split(" | ") if s]
                    row["ai_edited"] = str(row.get("ai_edited", "")).lower() in {"1", "true", "yes"}
                    row["views"] = int(row.get("views") or 0)
                    row["epub_variants"] = json.loads(row.get("epub_variants") or "[]")
                    row["file_size"] = int(row.get("file_size") or 0)
                    book = Book.from_dict(row)
                    self.books[book.id] = book
    def get(self, book_id: str) -> Book | None:
        return self.books.get(book_id)

    def upsert(self, book: Book) -> Book:
        old = self.books.get(book.id)
        if old:
            book.category = old.category
            book.categories = list(dict.fromkeys([*old.categories, *book.categories]))
            same_epub = old.epub_url == book.epub_url or (
                bool(drive_file_id(old.epub_url)) and drive_file_id(old.epub_url) == drive_file_id(book.epub_url)
            )
            if same_epub and old.download_status == "SUCCESS" and self.valid_file(old):
                book.download_status = "SUCCESS"
                book.file_path = old.file_path
                book.file_size = old.file_size
            elif same_epub and old.download_status == "SKIPPED" and old.file_path and self.valid_file(old):
                book.download_status = "SKIPPED"
                book.file_path = old.file_path
                book.file_size = old.file_size
        self.books[book.id] = book
        self.save()
        return book

    def valid_file(self, book: Book) -> bool:
        if not book.file_path:
            return False
        path = self.root / book.file_path
        if not path.is_file():
            return False
        try:
            validate_epub(path)
        except (OSError, ValueError, zipfile.BadZipFile):
            return False
        return True

    def reconcile_moved_files(self) -> int:
        """Repair SUCCESS paths after the user reorganizes EPUBs under downloads/."""
        downloads = self.root / "downloads"
        if not downloads.is_dir():
            return 0
        by_name: dict[str, list[Path]] = {}
        for path in downloads.rglob("*.epub"):
            by_name.setdefault(path.name, []).append(path)
        changed = 0
        for book in self.books.values():
            if book.download_status != "SUCCESS" or not book.file_path or (self.root / book.file_path).is_file():
                continue
            name = Path(book.file_path).name
            matches = by_name.get(name, [])
            if len(matches) != 1:
                continue
            try:
                validate_epub(matches[0])
            except (OSError, ValueError, zipfile.BadZipFile):
                continue
            book.file_path = matches[0].relative_to(self.root).as_posix()
            changed += 1
        if changed:
            self.save()
        return changed

    def duplicate(self, book: Book) -> Book | None:
        file_id = drive_file_id(book.epub_url)
        for other in self.books.values():
            if other.id == book.id or other.download_status != "SUCCESS":
                continue
            if other.detail_url == book.detail_url or (file_id and file_id == drive_file_id(other.epub_url)):
                return other if self.valid_file(other) else None
        return None

    def save(self) -> None:
        self.csv_path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile("w", encoding="utf-8-sig", newline="", dir=self.csv_path.parent, prefix=".books-", suffix=".tmp", delete=False) as stream:
            tmp_name = stream.name
            writer = csv.DictWriter(stream, fieldnames=CSV_FIELDS)
            writer.writeheader()
            for book in self.books.values():
                row = book.to_dict()
                row["categories"] = " | ".join(book.categories)
                row["formats"] = " | ".join(book.formats)
                for field in ("tags",):
                    row[field] = " | ".join(row.get(field) or [])
                row["epub_variants"] = json.dumps(book.epub_variants, ensure_ascii=False)
                writer.writerow({field: row.get(field, "") for field in CSV_FIELDS})
        _replace_with_retry(tmp_name, self.csv_path)
