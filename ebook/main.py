from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path

import requests
from rich.console import Console
from rich.table import Table

import config
from src.crawler import Crawler, USER_AGENT
from src.downloader import download_epub
from src.inventory import EpubInventory
from src.models import Book
from src.parser import detail_id, parse_detail
from src.selection import PRIORITY, select_preferred, title_key
from src.storage import Storage
from src.utils import CATEGORY_FOLDERS, CATEGORY_INFO, TRANSLATION_FOLDERS, book_path, fold, is_completed

ROOT = Path(__file__).resolve().parent
CATEGORY_URLS = {
    f"https://dtv-ebook.com.vn/{slug}-{category_id}.html": slug
    for slug, (category_id, _label) in CATEGORY_INFO.items()
}
console = Console(force_terminal=False)


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Quét một danh mục DTV và tải mọi EPUB Hoàn Thành")
    parser.add_argument("--from-csv", action="store_true", help="Dùng dữ liệu đã quét trong data/books.csv, không crawl lại")
    parser.add_argument("--browser-export", type=Path, help="Nhập JSON được xuất từ Chrome thay vì crawl trực tiếp")
    parser.add_argument("--scan-only", action="store_true", help="Chỉ quét và lưu metadata, chưa tải EPUB")
    parser.add_argument("--resume", action="store_true", help="Quét lại danh mục nhưng dùng metadata đã lưu khi có thể")
    parser.add_argument("--max-pages", type=int, help="Giới hạn số trang để chạy thử")
    parser.add_argument("--max-books", type=int, help="Giới hạn số truyện để chạy thử")
    args = parser.parse_args()
    if args.from_csv and (args.scan_only or args.resume or args.max_pages or args.max_books or args.browser_export):
        parser.error("--from-csv không dùng cùng --scan-only, --resume hoặc giới hạn quét")
    if args.browser_export and (args.scan_only or args.resume or args.max_pages or args.max_books):
        parser.error("--browser-export không dùng cùng --scan-only, --resume hoặc giới hạn quét")
    if args.scan_only and args.resume:
        parser.error("--scan-only không dùng cùng --resume")
    if args.max_pages is not None and args.max_pages < 1:
        parser.error("--max-pages phải lớn hơn 0")
    if args.max_books is not None and args.max_books < 1:
        parser.error("--max-books phải lớn hơn 0")
    return args


def settings() -> list[tuple[str, str, Path]]:
    urls = config.INPUT_URLS
    if not isinstance(urls, (list, tuple)) or not urls:
        raise ValueError("INPUT_URLS trong config.py phải là danh sách URL không rỗng")
    output = Path(config.OUTPUT_DIR).resolve()
    if output == ROOT or not output.is_relative_to(ROOT):
        raise ValueError("OUTPUT_DIR trong config.py phải nằm trong workspace và không phải thư mục gốc")
    configured = []
    seen: set[str] = set()
    for raw_url in urls:
        if not isinstance(raw_url, str):
            raise ValueError("Mỗi mục INPUT_URLS phải là một URL dạng chuỗi")
        url = raw_url.strip().rstrip("/")
        slug = CATEGORY_URLS.get(url)
        if not slug:
            raise ValueError(f"URL thể loại không được hỗ trợ trong INPUT_URLS: {raw_url}")
        if slug in seen:
            raise ValueError(f"Thể loại bị lặp trong INPUT_URLS: {CATEGORY_FOLDERS[slug]}")
        seen.add(slug)
        label = CATEGORY_FOLDERS[slug]
        configured.append((slug, label, output / label))
    return configured


def _record_path(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def _destination(storage: Storage, book: Book, output_dir: Path) -> Path:
    dest = book_path(output_dir, book.translation_type, book.title, book.author)
    original = dest
    index = 1
    while (dest.exists() and book.file_path != _record_path(dest)) or any(
        other.id != book.id and other.file_path == _record_path(dest)
        for other in storage.books.values()
    ):
        suffix = f" [{book.id}]" if index == 1 else f" [{book.id}-{index}]"
        dest = original.with_name(f"{original.stem}{suffix}{original.suffix}")
        index += 1
    return dest


def _remove_inferior_copies(book: Book, storage: Storage, inventory: EpubInventory, new_path: Path) -> None:
    """Retire only matching full EPUBs after the replacement is downloaded."""
    for entry in inventory.matches(book):
        old_path = (inventory.downloads / entry["relative_path"]).resolve()
        if old_path == new_path.resolve() or not old_path.is_relative_to(inventory.downloads):
            continue
        if PRIORITY.get(entry["translation_type"], 0) >= PRIORITY.get(book.translation_type, 0):
            continue
        referenced = [other for other in storage.books.values() if other.file_path == _record_path(old_path)]
        if any(title_key(other.title) != title_key(book.title) or fold(other.author) != fold(book.author)
               for other in referenced):
            console.print(f"[KEEP] {old_path.name}: file đang được bộ khác tham chiếu")
            continue
        try:
            old_path.unlink()
        except OSError as exc:
            console.print(f"[KEEP] {old_path.name}: không xóa được: {exc}")
            continue
        for other in referenced:
            other.download_status = "SKIPPED"
            other.file_path = ""
            other.file_size = 0
            other.error = f"Ưu tiên bản {book.translation_type} (ID {book.id})"
        if referenced:
            storage.save()
        inventory.remove(old_path)
        console.print(f"[REPLACE] Đã xóa bản cũ: {entry['relative_path']}")


def _remove_huyen_duplicates(storage: Storage, inventory: EpubInventory) -> int:
    """Keep full Tiên Hiệp EPUBs as the reference; never delete split EPUBs."""
    removed = 0
    for entry in list(inventory.files):
        if entry["category"] != "Huyền Ảo" or entry["part"] != "full":
            continue
        candidate = Book("", entry["title"], "", "Huyền Ảo", author=entry["author"])
        tien = inventory.best_existing(candidate, category="Tiên Hiệp")
        if not tien:
            continue
        path = (inventory.downloads / entry["relative_path"]).resolve()
        if not path.is_relative_to(inventory.downloads) or not path.is_file():
            continue
        references = [book for book in storage.books.values() if book.file_path == _record_path(path)]
        if any(title_key(book.title) != title_key(candidate.title) or fold(book.author) != fold(candidate.author)
               for book in references):
            console.print(f"[KEEP] {path.name}: có tham chiếu CSV không cùng bộ")
            continue
        try:
            path.unlink()
        except OSError as exc:
            console.print(f"[KEEP] {path.name}: không xóa được: {exc}")
            continue
        for book in references:
            book.download_status = "SKIPPED"
            book.file_path = ""
            book.file_size = 0
            book.error = f"Trùng EPUB Tiên Hiệp: {tien['relative_path']}"
        if references:
            storage.save()
        inventory.remove(path)
        removed += 1
        console.print(f"[DEDUP] Đã xóa Huyền Ảo trùng Tiên Hiệp: {entry['relative_path']}")
    return removed


def _download(
    book: Book, storage: Storage, session: requests.Session,
    counts: dict[str, int], output_dir: Path, inventory: EpubInventory,
) -> None:
    if book.download_status == "SUCCESS" and storage.valid_file(book):
        counts["already"] += 1
        console.print(f"[SKIP] {book.title}: đã tải")
        return
    indexed = (
        inventory.best_existing(book, category="Tiên Hiệp")
        if output_dir.name == "Huyền Ảo" else None
    ) or inventory.best_existing(book)
    if indexed and (
        PRIORITY.get(indexed["translation_type"], 0) >= PRIORITY.get(book.translation_type, 0)
        or (output_dir.name == "Huyền Ảo" and indexed["category"] == "Tiên Hiệp")
    ):
        path = inventory.downloads / indexed["relative_path"]
        book.download_status = "SKIPPED"
        book.file_path = _record_path(path)
        book.file_size = path.stat().st_size
        book.error = f"Đã có EPUB trong {indexed['category']}: {indexed['relative_path']}"
        storage.upsert(book)
        counts["already"] += 1
        console.print(f"[SKIP] {book.title}: đã có trong {indexed['category']}")
        return
    existing = storage.duplicate(book)
    if existing:
        book.download_status = "SKIPPED"
        book.file_path = existing.file_path
        book.file_size = existing.file_size
        storage.upsert(book)
        counts["already"] += 1
        console.print(f"[SKIP] {book.title}: trùng EPUB")
        return
    destination = _destination(storage, book, output_dir)
    book.file_path = _record_path(destination)
    if destination.exists() and storage.valid_file(book):
        book.download_status = "SUCCESS"
        book.file_size = destination.stat().st_size
        storage.upsert(book)
        try:
            inventory.add(book, destination)
        except OSError as exc:
            console.print(f"[INDEX WARNING] Chưa cập nhật được JSON: {exc}")
        counts["already"] += 1
        console.print(f"[SKIP] {book.title}: file EPUB hợp lệ đã tồn tại")
        return
    try:
        console.print(f"[DOWNLOAD] {book.title}")
        size = download_epub(book, destination, session)
    except (requests.RequestException, OSError, ValueError, zipfile.BadZipFile) as exc:
        book.download_status = "FAILED"
        book.file_path = ""
        book.file_size = 0
        book.error = str(exc)[:500]
        storage.upsert(book)
        counts["failed"] += 1
        console.print(f"[FAILED] {book.title}: {book.error}")
        return
    book.file_size = size
    book.download_status = "SUCCESS"
    book.error = ""
    storage.upsert(book)
    counts["downloaded"] += 1
    console.print(f"[SUCCESS] {book.title} ({size:,} bytes)")
    try:
        inventory.add(book, destination)
        _remove_inferior_copies(book, storage, inventory, destination)
    except OSError as exc:
        console.print(f"[INDEX WARNING] EPUB đã tải nhưng chưa cập nhật đủ JSON: {exc}")


def _page_table(label: str, page_number: int, items: list[tuple[str, str, str]]) -> None:
    table = Table(title=f"{label} — trang {page_number} ({len(items)} truyện)")
    table.add_column("#", justify="right")
    table.add_column("Truyện")
    table.add_column("Tình trạng trên danh mục")
    for position, (title, _url, status) in enumerate(items, 1):
        table.add_row(str(position), title, status or "Chưa rõ")
    console.print(table)


def _retire_lower_priority(
    storage: Storage, lower_priority: dict[str, str], output_dir: Path,
    counts: dict[str, int], inventory: EpubInventory,
) -> None:
    """Remove only an indexed, unshared EPUB after its preferred replacement is valid."""
    for old_id, winner_id in lower_priority.items():
        old, winner = storage.books[old_id], storage.books[winner_id]
        if winner.download_status != "SUCCESS" or not storage.valid_file(winner):
            continue
        if old.download_status == "SUCCESS" and old.file_path and storage.valid_file(old):
            old_path = (ROOT / old.file_path).resolve()
            if not old_path.is_relative_to(output_dir.resolve()):
                console.print(f"[KEEP] {old.title}: file cũ ngoài thư mục danh mục, không tự xóa")
                continue
            if any(other.id != old.id and other.file_path == old.file_path
                   for other in storage.books.values()):
                console.print(f"[KEEP] {old.title}: file cũ đang được truyện khác dùng")
                continue
            try:
                old_path.unlink()
            except OSError as exc:
                console.print(f"[KEEP] {old.title}: không xóa được file cũ: {exc}")
                continue
            console.print(f"[REPLACE] Đã xóa bản {old.translation_type}: {old.file_path}")
            inventory.remove(old_path)
        if old.download_status != "SKIPPED" or old.file_path:
            counts["skipped"] += 1
            old.download_status = "SKIPPED"
            old.file_path = ""
            old.file_size = 0
            old.error = f"Ưu tiên bản {winner.translation_type} (ID {winner_id})"
            storage.save()


def _download_current_winners(
    storage: Storage, seen: set[str], session: requests.Session,
    counts: dict[str, int], output_dir: Path, attempted: set[str], inventory: EpubInventory,
) -> None:
    eligible = [
        book for book in storage.books.values() if book.id in seen and book.epub_url
        and is_completed(book.status, config.ALLOW_CV_FULL)
    ]
    winners, lower_priority = select_preferred(eligible, storage.valid_file)
    counts["selected"] = len(winners)
    for book in winners:
        if book.id in attempted:
            continue
        attempted.add(book.id)
        console.print(f"[BOOK {len(attempted)}] {book.title} | {book.translation_type}")
        _download(book, storage, session, counts, output_dir, inventory)
    _retire_lower_priority(storage, lower_priority, output_dir, counts, inventory)


def _scan_site(
    args: argparse.Namespace, storage: Storage, slug: str, label: str,
    seen: set[str], unresolved_titles: set[str], counts: dict[str, int],
    session: requests.Session | None = None, output_dir: Path | None = None,
    inventory: EpubInventory | None = None,
) -> bool:
    console.print("[CONNECT] Đang kiểm tra robots.txt...")
    try:
        crawler = Crawler()
    except (requests.RequestException, OSError, PermissionError) as exc:
        console.print(f"[FAILED] Không thể kiểm tra robots.txt: {exc}")
        counts["failed"] += 1
        return True
    if hasattr(crawler, "on_progress"):
        crawler.on_progress = console.print
    limit_reached = False
    attempted: set[str] = set()
    try:
        for page_number, items in crawler.category_pages(slug, max_pages=args.max_pages):
            console.print(f"[SCAN] {label} trang {page_number}: {len(items)} truyện")
            _page_table(label, page_number, items)
            for position, (card_title, detail_url, _card_status) in enumerate(items, 1):
                book_id = detail_id(detail_url)
                if book_id in seen:
                    continue
                seen.add(book_id)
                old = storage.get(book_id)
                if old and args.resume and old.status and old.description and old.epub_variants and (old.epub_url or old.download_status == "NOT_COMPLETED"):
                    console.print(f"[DETAIL {position}/{len(items)}] {card_title}: dùng dữ liệu đã lưu")
                    book = Book.from_dict(old.to_dict())
                    if label not in book.categories:
                        book.categories.append(label)
                else:
                    try:
                        console.print(f"[DETAIL {position}/{len(items)}] Đang kiểm tra: {card_title}")
                        response = crawler.get(detail_url)
                        book = parse_detail(response.text, detail_url, label, card_title)
                    except (requests.RequestException, OSError, ValueError, PermissionError) as exc:
                        book = old or Book(book_id, card_title, detail_url, label, [label])
                        book.download_status = "FAILED"
                        book.error = str(exc)[:500]
                        storage.upsert(book)
                        unresolved_titles.add(title_key(card_title))
                        counts["failed"] += 1
                        console.print(f"[FAILED] {card_title}: {book.error}")
                        if args.max_books and len(seen) >= args.max_books:
                            limit_reached = True
                            break
                        continue
                book = storage.upsert(book)
                console.print(f"[CHECK] {book.title} | {book.status} | EPUB: {'YES' if book.epub_url else 'NO'} | {book.translation_type}")
                if not is_completed(book.status, config.ALLOW_CV_FULL):
                    if book.download_status != "SUCCESS":
                        book.download_status = "NOT_COMPLETED"
                        storage.upsert(book)
                    counts["skipped"] += 1
                elif not book.epub_url:
                    if book.download_status != "SUCCESS":
                        book.download_status = "NO_EPUB"
                        storage.upsert(book)
                    counts["skipped"] += 1
                if args.max_books and len(seen) >= args.max_books:
                    limit_reached = True
                    break
            console.print(f"[PAGE DONE] Trang {page_number}: đã kiểm tra {min(len(items), position)} truyện")
            if session is not None and output_dir is not None and inventory is not None:
                console.print(f"[SELECT] Chọn EPUB Hoàn Thành sau trang {page_number}; bắt đầu tải")
                _download_current_winners(storage, seen, session, counts, output_dir, attempted, inventory)
            if limit_reached:
                break
    except (requests.RequestException, OSError, PermissionError, ValueError) as exc:
        console.print(f"[FAILED] Danh mục {label}: {exc}")
        counts["failed"] += 1
        return True
    return False


def _scan_browser_export(
    export_path: Path, storage: Storage, category_url: str, label: str,
    seen: set[str], unresolved_titles: set[str], counts: dict[str, int],
) -> bool:
    try:
        raw = json.loads(export_path.read_text(encoding="utf-8"))
        if raw.get("version") != 1 or raw.get("category_url") != category_url:
            raise ValueError("File export không khớp URL thể loại trong config.py")
        details = raw.get("details")
        if not isinstance(details, list):
            raise ValueError("File export thiếu danh sách details")
        for position, item in enumerate(details, 1):
            if not isinstance(item, dict):
                raise ValueError(f"Mục details #{position} không hợp lệ")
            detail_url = str(item.get("url", ""))
            card_title = str(item.get("title", ""))
            html = item.get("html")
            book_id = detail_id(detail_url)
            if not book_id or not isinstance(html, str):
                raise ValueError(f"Mục details #{position} thiếu URL hoặc HTML hợp lệ")
            if book_id in seen:
                continue
            seen.add(book_id)
            try:
                book = parse_detail(html, detail_url, label, card_title)
            except ValueError as exc:
                book = storage.get(book_id) or Book(book_id, card_title, detail_url, label, [label])
                book.download_status = "FAILED"
                book.error = str(exc)[:500]
                storage.upsert(book)
                unresolved_titles.add(title_key(card_title))
                counts["failed"] += 1
                console.print(f"[FAILED] {card_title}: {book.error}")
                continue
            storage.upsert(book)
            console.print(
                f"[IMPORT {position}/{len(details)}] {book.title} | {book.status} | "
                f"EPUB: {'YES' if book.epub_url else 'NO'} | {book.translation_type}"
            )
            if not is_completed(book.status, config.ALLOW_CV_FULL) or not book.epub_url:
                counts["skipped"] += 1
        return False
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        console.print(f"[FAILED] Không thể nhập browser export: {exc}")
        counts["failed"] += 1
        return True


def summary(storage: Storage, seen: set[str], counts: dict[str, int]) -> None:
    books = [storage.books[book_id] for book_id in seen]
    table = Table(title="SUMMARY")
    table.add_column("Chỉ số")
    table.add_column("Số lượng", justify="right")
    rows = [
        ("Đã quét", len(books)),
        ("Hoàn Thành", sum(is_completed(book.status, config.ALLOW_CV_FULL) for book in books)),
        ("Hoàn Thành + EPUB", sum(is_completed(book.status, config.ALLOW_CV_FULL) and bool(book.epub_url) for book in books)),
        ("Được chọn", counts["selected"]),
        ("Tải mới", counts["downloaded"]),
        ("Đã có", counts["already"]),
        ("Bỏ qua", counts["skipped"]),
        ("Lỗi", counts["failed"]),
    ]
    for label, value in rows:
        table.add_row(label, str(value))
    console.print(table)


def main() -> int:
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")
    if sys.stderr.encoding and sys.stderr.encoding.lower() != "utf-8":
        sys.stderr.reconfigure(encoding="utf-8")
    args = arguments()
    try:
        categories = settings()
    except ValueError as exc:
        console.print(f"[FAILED] {exc}")
        return 1
    storage = Storage(ROOT)
    relocated = storage.reconcile_moved_files()
    if relocated:
        console.print(f"[INDEX] Đã cập nhật đường dẫn của {relocated} EPUB được chuyển thư mục")
    if args.from_csv and not storage.books:
        console.print("[FAILED] data/books.csv chưa có dữ liệu")
        return 1
    inventory = EpubInventory(categories[0][2].parent, storage)
    console.print(f"[INDEX] {inventory.path}: {len(inventory.files)} EPUB trên đĩa")
    if not args.scan_only:
        removed = _remove_huyen_duplicates(storage, inventory)
        console.print(f"[DEDUP] EPUB Huyền Ảo trùng bản đầy đủ Tiên Hiệp đã xóa: {removed}")
    session = requests.Session() if not args.scan_only else None
    if session is not None:
        session.headers.update({"User-Agent": USER_AGENT})
    any_failed = False
    for category_number, (slug, label, output_dir) in enumerate(categories, 1):
        console.print(f"[CATEGORY {category_number}/{len(categories)}] {label} -> {output_dir}")
        if not args.scan_only:
            for folder in set(TRANSLATION_FOLDERS.values()):
                (output_dir / folder).mkdir(parents=True, exist_ok=True)
        seen: set[str] = set()
        unresolved_titles: set[str] = set()
        counts = {"selected": 0, "downloaded": 0, "already": 0, "skipped": 0, "failed": 0}
        browser_export = getattr(args, "browser_export", None)
        if args.from_csv:
            seen = {book.id for book in storage.books.values() if label in (book.categories or [book.category])}
            unresolved_titles = {
                title_key(storage.books[book_id].title) for book_id in seen
                if storage.books[book_id].download_status == "FAILED" and not storage.books[book_id].status
            }
            listing_failed = False
        elif browser_export:
            category_url = f"https://dtv-ebook.com.vn/{slug}-{CATEGORY_INFO[slug][0]}.html"
            listing_failed = _scan_browser_export(
                browser_export.resolve(), storage, category_url, label,
                seen, unresolved_titles, counts,
            )
        else:
            listing_failed = _scan_site(args, storage, slug, label, seen, unresolved_titles, counts, session, output_dir, inventory)
        storage.save()
        eligible = [
            book for book in storage.books.values() if book.id in seen
            and is_completed(book.status, config.ALLOW_CV_FULL) and book.epub_url
        ]
        winners, _lower_priority = select_preferred(eligible, storage.valid_file)
        counts["selected"] = len(winners)
        console.print(f"[SELECT] {len(winners)} EPUB Hoàn Thành tốt nhất đã thấy của {label}")
        if (args.from_csv or browser_export) and session is not None:
            _download_current_winners(storage, seen, session, counts, output_dir, set(), inventory)
        elif listing_failed and session is not None:
            console.print("[NOTICE] Danh mục bị gián đoạn; EPUB của các trang đã quét vẫn được giữ. Chạy --resume để tiếp tục.")
        summary(storage, seen, counts)
        any_failed = any_failed or listing_failed or bool(counts["failed"])
    return 1 if any_failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
