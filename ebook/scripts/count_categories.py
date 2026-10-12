"""Count unique detail URLs on the two public category listings."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.crawler import Crawler
from src.parser import detail_id
from src.selection import title_key
from src.utils import CATEGORY_FOLDERS, is_completed


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    crawler = Crawler()
    all_ids: set[str] = set()
    all_titles: set[str] = set()
    for slug, label in CATEGORY_FOLDERS.items():
        ids: set[str] = set()
        titles: set[str] = set()
        completed = 0
        pages = 0
        for page, items in crawler.category_pages(slug):
            pages = page
            for title, url, card_status in items:
                book_id = detail_id(url)
                titles.add(title_key(title))
                if book_id not in ids:
                    ids.add(book_id)
                    completed += is_completed(card_status)
            print(f"{label}: page {page}, {len(ids)} unique books", flush=True)
        print(f"TOTAL {label}: {len(ids)} detail entries; {len(titles)} distinct titles; {completed} completed on cards; {pages} pages", flush=True)
        print(f"OVERLAP with earlier categories: {len(ids & all_ids)} detail IDs; {len(titles & all_titles)} titles", flush=True)
        all_ids.update(ids)
        all_titles.update(titles)
    print(f"UNIQUE across both: {len(all_ids)} detail IDs; {len(all_titles)} titles", flush=True)


if __name__ == "__main__":
    main()
