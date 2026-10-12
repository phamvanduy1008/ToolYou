import logging
import re
from datetime import datetime, timezone
from urllib.parse import urlsplit

from app.config import DATA_DIR, current_book_directories
from app.crawler.client import AccessDeniedError, HttpClient
from app.crawler.parser import (
    parse_book_page, parse_catalogue_url, parse_chapter_page,
    parse_chapter_page_count, parse_pagination_urls,
)
from app.models import Chapter
from app.storage.json_store import (
    atomic_write_json, atomic_write_text, chapter_text_path, read_json, valid_chapter_text,
)


def _book_title(html: str) -> str:
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "lxml")
    node = soup.select_one('meta[property="og:novel:book_name"][content]')
    if node:
        return str(node.get("content", "")).strip()
    heading = soup.select_one("h1")
    return heading.get_text(" ", strip=True) if heading else ""


def _chapter_subpage_url(url: str, page: int) -> str:
    if page == 1:
        return url
    if not url.endswith(".html"):
        raise ValueError(f"Unsupported chapter URL for pagination: {url}")
    return f"{url[:-5]}_{page}.html"


def _order_chapters_by_title(chapters: list[Chapter]) -> list[Chapter]:
    """Order catalogue entries by their explicit `第N章` number.

    Pagination controls can expose a far-away page before the next page. Using
    discovery order in that case silently assigns the wrong local file number.
    Duplicate catalogue entries for the same chapter number are collapsed.
    """
    numbered: dict[int, Chapter] = {}
    unnumbered: list[Chapter] = []
    for chapter in chapters:
        match = re.search(r"第\s*(\d+)\s*章", chapter.title)
        if match:
            numbered.setdefault(int(match.group(1)), chapter)
        else:
            unnumbered.append(chapter)
    if not numbered:
        return chapters
    if unnumbered:
        logging.warning(
            "[CRAWL] ignoring %d catalogue links without a 第N章 number: %s",
            len(unnumbered),
            ", ".join(chapter.title for chapter in unnumbered[:5]),
        )
    return [numbered[number] for number in sorted(numbered)]


def _number_chapters(chapters: list[Chapter], book_url: str) -> list[Chapter]:
    """Order chapters and assign stable file numbers for a supported site."""
    if urlsplit(book_url).netloc.lower().endswith("biquge321.com"):
        # This catalogue is a single chronological list, but a few displayed
        # chapter numbers are duplicated/mistyped. Its list position preserves
        # every link and is more reliable than those labels.
        for position, chapter in enumerate(chapters, 1):
            match = re.search(r"第\s*(\d+)\s*章", chapter.title)
            if match and int(match.group(1)) != position:
                logging.warning(
                    "[CRAWL] catalogue position %d has title number %s: %s",
                    position, match.group(1), chapter.title,
                )
            chapter.index = position
        return chapters

    chapters = _order_chapters_by_title(chapters)
    for chapter in chapters:
        # `_order_chapters_by_title` guarantees every retained title has this
        # number. Preserve it even if the remote catalogue has a gap.
        chapter.index = int(re.search(r"第\s*(\d+)\s*章", chapter.title).group(1))
    return chapters


def _fetch_complete_chapter(client: HttpClient, chapter: Chapter) -> tuple[str, str]:
    first_html = client.get(chapter.url)
    title, first_content = parse_chapter_page(first_html, chapter.url)
    page_count = parse_chapter_page_count(first_html)
    contents = [first_content]
    for page in range(2, page_count + 1):
        page_url = _chapter_subpage_url(chapter.url, page)
        _, content = parse_chapter_page(client.get(page_url), page_url)
        contents.append(content)
    return title, "\n\n".join(contents)


def crawl_book(book_url: str, start: int | None = None, end: int | None = None,
               force: bool = False) -> None:
    client = HttpClient()
    first_html = client.get(book_url)
    catalogue_url = parse_catalogue_url(first_html, book_url)
    if catalogue_url != book_url:
        print(f"Resolved catalogue: {catalogue_url}")
        book_url = catalogue_url
        first_html = client.get(book_url)
    chapters = parse_book_page(first_html, book_url)
    seen = {chapter.url for chapter in chapters}
    queued = parse_pagination_urls(first_html, book_url)
    visited: set[str] = set()
    while queued:
        page_url = queued.pop(0)
        if page_url in visited:
            continue
        visited.add(page_url)
        page_html = client.get(page_url)
        for candidate in parse_pagination_urls(page_html, book_url):
            if candidate not in visited and candidate not in queued:
                queued.append(candidate)
        for chapter in parse_book_page(page_html, book_url):
            if chapter.url not in seen:
                seen.add(chapter.url)
                chapters.append(chapter)
    chapters = _number_chapters(chapters, book_url)
    title_cn = _book_title(first_html)
    metadata = read_json(DATA_DIR / "book.json")
    if metadata.get("source_url") != book_url:
        # A translated title belongs to the previous active book. Keeping it
        # would route this new source into the previous book's directories.
        metadata.pop("title_vi", None)
        metadata.pop("author", None)
    metadata.update({"title_cn": title_cn, "source_url": book_url,
                     "source_domain": urlsplit(book_url).netloc,
                     "chapter_count": max(chapter.index for chapter in chapters),
                     "last_crawled_at": datetime.now(timezone.utc).isoformat()})
    atomic_write_json(DATA_DIR / "book.json", metadata)
    # Resolve storage from the persisted metadata so crawl, translation,
    # status, and export always use the same Vietnamese book folder when set.
    raw_book_dir, _ = current_book_directories()
    selected = [c for c in chapters if (start is None or c.index >= start) and (end is None or c.index <= end)]
    print(f"Detected chapters: {len(chapters)}\nSelected: {len(selected)}")
    success = skipped = failed = 0
    for position, chapter in enumerate(selected, 1):
        path = chapter_text_path(raw_book_dir, chapter.index)
        if not force and valid_chapter_text(path):
            skipped += 1; print(f"[{position}/{len(selected)}] {chapter.index:06d} SKIP"); continue
        try:
            title, content = _fetch_complete_chapter(client, chapter)
            atomic_write_text(path, content)
            success += 1
            print(f"[{position}/{len(selected)}] {chapter.index:06d} OK {title}")
        except AccessDeniedError:
            raise
        except Exception as exc:
            failed += 1; logging.exception("[CRAWL] %06d ERROR %s", chapter.index, exc)
    print(f"Finished\nSuccess: {success}\nSkipped: {skipped}\nFailed: {failed}")

