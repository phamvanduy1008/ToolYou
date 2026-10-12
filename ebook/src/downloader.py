from __future__ import annotations

import os
import tempfile
import time
import zipfile
from pathlib import Path
from urllib.parse import urlparse

import requests
from rich.console import Console
from rich.progress import BarColumn, DownloadColumn, Progress, TextColumn, TransferSpeedColumn

from .models import Book

RETRY_STATUSES = {429, 500, 502, 503, 504}
console = Console(force_terminal=False)


def validate_epub(path: Path) -> None:
    with path.open("rb") as stream:
        if stream.read(4) != b"PK\x03\x04":
            raise ValueError("File không bắt đầu bằng ZIP hợp lệ")
    if not zipfile.is_zipfile(path):
        raise ValueError("File không phải ZIP hợp lệ")
    with zipfile.ZipFile(path) as archive:
        try:
            mimetype = archive.read("mimetype").strip()
        except KeyError as exc:
            raise ValueError("EPUB thiếu file mimetype") from exc
        if mimetype != b"application/epub+zip":
            raise ValueError("mimetype không phải application/epub+zip")
        bad_member = archive.testzip()
        if bad_member:
            raise ValueError(f"EPUB có dữ liệu ZIP hỏng: {bad_member}")


def download_epub(book: Book, destination: Path, session: requests.Session) -> int:
    if urlparse(book.epub_url).scheme not in {"http", "https"}:
        raise ValueError("URL EPUB không hợp lệ")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        for attempt in range(5):
            try:
                with session.get(book.epub_url, stream=True, allow_redirects=True, timeout=(20, 90)) as response:
                    if response.status_code in RETRY_STATUSES:
                        if attempt == 4:
                            response.raise_for_status()
                        console.print(f"[RETRY] HTTP {response.status_code}: tải lại {book.title} ({attempt + 2}/5) sau {2 ** (attempt + 1)} giây")
                        time.sleep(2 ** (attempt + 1))
                        continue
                    response.raise_for_status()
                    content_type = response.headers.get("Content-Type", "").lower()
                    if "text/html" in content_type:
                        raise ValueError("Máy chủ trả về HTML thay vì EPUB")
                    with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=".epub-", suffix=".part", delete=False) as stream:
                        temporary = Path(stream.name)
                        total = int(response.headers.get("Content-Length", "0")) or None
                        with Progress(TextColumn("[cyan]{task.description}"), BarColumn(), DownloadColumn(), TransferSpeedColumn(), transient=False) as progress:
                            task = progress.add_task(book.title, total=total)
                            for chunk in response.iter_content(chunk_size=256 * 1024):
                                if chunk:
                                    stream.write(chunk)
                                    progress.update(task, advance=len(chunk))
                    validate_epub(temporary)
                    size = temporary.stat().st_size
                    os.replace(temporary, destination)
                    temporary = None
                    return size
            except (requests.Timeout, requests.ConnectionError) as exc:
                if attempt == 4:
                    raise
                console.print(f"[RETRY] {type(exc).__name__}: tải lại {book.title} ({attempt + 2}/5) sau {2 ** (attempt + 1)} giây")
                time.sleep(2 ** (attempt + 1))
        raise RuntimeError("Hết lượt thử tải EPUB")
    finally:
        if temporary and temporary.exists():
            temporary.unlink()
