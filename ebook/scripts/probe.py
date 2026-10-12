"""Read five category cards and one detail page without downloading."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.crawler import Crawler
from src.parser import parse_category, parse_detail


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    crawler = Crawler()
    category_url = "https://dtv-ebook.com.vn/huyen-ao-497.html"
    cards = parse_category(crawler.get(category_url).text, category_url)
    print("First five category cards:")
    for title, url, status in cards[:5]:
        print(f"- {title} | {status} | {url}")
    detail_url = "https://dtv-ebook.com.vn/qua-mang_26722.html"
    book = parse_detail(crawler.get(detail_url).text, detail_url, "Huyền Ảo")
    print("\nSample detail:")
    for field in ("title", "author", "status", "views", "tags", "translation_type", "ai_edited", "editor", "epub_url"):
        print(f"{field}: {getattr(book, field)}")


if __name__ == "__main__":
    main()
