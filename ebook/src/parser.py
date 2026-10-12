from __future__ import annotations

import re
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup, Tag

from .models import Book
from .selection import PRIORITY
from .utils import CATEGORY_FOLDERS, compact, fold

DETAIL_RE = re.compile(r"_([0-9]+)\.html$")
STAGE_MARKER_RE = re.compile(
    r"chuong\s*[0-9][\d.]*\s*[-–]\s*[0-9][\d.]*\s*:"
    r"|(?:dich|cv|convert|ai)\s+den\s+chuong\s*[0-9][\d.]*"
)


def detail_id(url: str) -> str:
    match = DETAIL_RE.search(urlparse(url).path)
    return match.group(1) if match else ""


def _same_site_detail(href: str, base_url: str) -> str:
    url = urljoin(base_url, href)
    parsed = urlparse(url)
    return url if parsed.hostname == "dtv-ebook.com.vn" and detail_id(url) else ""


def parse_category(html: str, page_url: str) -> list[tuple[str, str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    items = soup.select(".noi_dung li.itemtruyen")
    results: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    for item in items:
        title_node = item.select_one(".hide-for-small-only h2.tensanpham") or item.select_one("h2.tensanpham")
        anchor = title_node.find_parent("a", href=True) if title_node else None
        if not anchor:
            continue
        url = _same_site_detail(anchor["href"], page_url)
        if not url or detail_id(url) in seen:
            continue
        seen.add(detail_id(url))
        status_node = item.select_one(".hide-for-small-only .tinhtrangtruyen") or item.select_one(".tinhtrangtruyen")
        results.append((compact(title_node.get_text(" ", strip=True)), url, compact(status_node.get_text(" ", strip=True)) if status_node else ""))

    if results:
        return results
    # Fallback stays inside the main category content, requiring a book title and a card.
    main = soup.select_one(".noi_dung")
    if not main:
        return []
    for title_node in main.select("h2.tensanpham"):
        anchor = title_node.find_parent("a", href=True)
        card = title_node.find_parent("li")
        if not anchor or not card:
            continue
        url = _same_site_detail(anchor["href"], page_url)
        if not url or detail_id(url) in seen:
            continue
        seen.add(detail_id(url))
        status_node = card.select_one(".tinhtrangtruyen")
        results.append((compact(title_node.get_text(" ", strip=True)), url, compact(status_node.get_text(" ", strip=True)) if status_node else ""))
    return results


def pagination_pages(html: str, category_slug: str) -> set[int]:
    soup = BeautifulSoup(html, "html.parser")
    pattern = re.compile(rf"/{re.escape(category_slug)}(?:/([0-9]+))?\.html$")
    pages = {1}
    for anchor in soup.select("a[href]"):
        match = pattern.search(urlparse(anchor["href"]).path)
        if match:
            pages.add(int(match.group(1) or 1))
    return pages


def _metadata_table(soup: BeautifulSoup) -> Tag | None:
    for table in soup.select("table"):
        labels = {fold(row.find("strong").get_text(" ", strip=True)) for row in table.select("tr") if row.find("strong")}
        if "tinh trang" in labels and "tac gia" in labels:
            return table
    return None


def _metadata(table: Tag) -> dict[str, str]:
    data: dict[str, str] = {}
    for row in table.select("tr"):
        cells = row.find_all("td", recursive=False)
        if len(cells) < 2:
            continue
        key = fold(cells[0].get_text(" ", strip=True))
        value = compact(cells[1].get_text(" ", strip=True))
        if key:
            data[key] = value
    return data


def _row_links(table: Tag, label: str) -> list[str]:
    for row in table.select("tr"):
        cells = row.find_all("td", recursive=False)
        if len(cells) >= 2 and fold(cells[0].get_text(" ", strip=True)) == label:
            return [compact(anchor.get_text(" ", strip=True)) for anchor in cells[1].select("a") if compact(anchor.get_text(" ", strip=True))]
    return []


def _stage_kind(text: str) -> str:
    if re.search(r"\bai\s*(?:dich|translate|da edit)\b|\bdich\s+ai\b", text):
        return "AI"
    if re.search(r"\bcv\b|\bconvert(?:ed)?\b", text):
        return "CONVERT"
    if re.search(r"\b(?:nguoi\s+dich|dich\s+gia|dich)\b", text):
        return "HUMAN"
    return ""


def classify_translation(metadata_text: str, description_text: str) -> str:
    text = fold(f"{metadata_text}\n{description_text}")
    markers = list(STAGE_MARKER_RE.finditer(text))
    stages = {
        _stage_kind(text[match.start():(markers[index + 1].start() if index + 1 < len(markers) else match.end() + 100)])
        for index, match in enumerate(markers)
    } - {""}
    if len(stages) >= 2:
        return "MIXED"
    if re.search(r"\bai\s*(?:dich|translate|da edit)\b|\bdich\s+ai\b", text):
        return "AI"
    if re.search(r"\bcv\b|\bconvert(?:ed)?\b", text):
        return "CONVERT"
    if re.search(r"\b(?:dich gia|nguoi dich|editor|bien tap|nhom dich)\s*:", text):
        return "HUMAN"
    return "UNKNOWN"


def _named_person(text: str, labels: set[str]) -> str:
    lines = [compact(line) for line in text.splitlines() if compact(line)]
    for index, line in enumerate(lines):
        key, sep, value = line.partition(":")
        if sep and fold(key) in labels:
            return compact(value or (lines[index + 1] if index + 1 < len(lines) else ""))[:180]
    return ""


def _variant_type(label: str, fallback: str) -> str:
    text = fold(label)
    has_ai = bool(re.search(r"\bai\b", text))
    has_cv = bool(re.search(r"\bcv\b|\bconvert", text))
    has_human = bool(re.search(r"\bnguoi dich\b|\bdich gia\b|\bban dich\b|\bdich full\b|\beditor\b", text))
    if sum((has_ai, has_cv, has_human)) > 1:
        return "MIXED"
    if has_human:
        return "HUMAN"
    if has_ai:
        return "AI"
    if has_cv:
        return "CONVERT"
    return fallback


def _epub_variants(soup: BeautifulSoup, base_url: str, fallback_type: str, fallback_edited: bool) -> list[dict]:
    variants: dict[str, dict] = {}

    def add(anchor: Tag, label: str) -> None:
        url = urljoin(base_url, anchor["href"])
        if urlparse(url).scheme not in {"http", "https"}:
            return
        kind = _variant_type(label, fallback_type)
        edited = kind == "AI" and (
            bool(re.search(r"\bai(?:\s+dich)?\s+(?:da|duoc)\s+edit\b|\bai\s+edit\b", fold(label)))
            or fallback_edited
        )
        candidate = {"label": compact(label), "url": url, "translation_type": kind, "ai_edited": edited}
        previous = variants.get(url)
        if previous is None or (PRIORITY.get(kind, 0), edited) > (PRIORITY.get(previous["translation_type"], 0), previous["ai_edited"]):
            variants[url] = candidate

    scope = soup.select_one("#chitiet") or soup
    for box in scope.select(".download-box"):
        for anchor in box.select("a[href]"):
            if re.search(r"\bepub\b", fold(anchor.get_text(" ", strip=True))):
                add(anchor, anchor.get_text(" ", strip=True))
    for row in soup.select("#download tr"):
        strong = row.find("strong")
        label = strong.get_text(" ", strip=True) if strong else ""
        for anchor in row.select("a[href]"):
            if fold(anchor.get_text(" ", strip=True)) == "epub":
                add(anchor, label)
    if not variants:
        table = _metadata_table(soup)
        if table:
            for row in table.select("tr"):
                strong = row.find("strong")
                label = strong.get_text(" ", strip=True) if strong else ""
                if not fold(label).startswith("full"):
                    continue
                for anchor in row.select("a[href]"):
                    if fold(anchor.get_text(" ", strip=True)) == "epub":
                        add(anchor, label)
    return list(variants.values())


def parse_detail(html: str, detail_url: str, category: str, card_title: str = "") -> Book:
    soup = BeautifulSoup(html, "html.parser")
    table = _metadata_table(soup)
    if table is None:
        raise ValueError("Không tìm thấy bảng metadata của truyện")
    data = _metadata(table)
    title_node = table.select_one("h2") or soup.select_one("h2.tensanpham")
    title = compact(title_node.get_text(" ", strip=True)) if title_node else card_title
    if not title:
        raise ValueError("Không tìm thấy tên truyện")
    description = soup.select_one("#chitiet")
    description_text = description.get_text("\n", strip=True) if description else ""
    metadata_text = table.get_text("\n", strip=True)
    description_without_download = description_text.split("Tải ebook", 1)[0]
    translation_type = classify_translation(metadata_text, description_without_download)
    folded_description = fold(f"{metadata_text} {description_without_download}")
    ai_edited = translation_type == "AI" and bool(
        re.search(r"\bai(?:\s+dich)?\s+(?:da|duoc)\s+(?:edit|bien tap)\b|\bai\s+edit\b", folded_description)
    )
    variants = _epub_variants(soup, detail_url, translation_type, ai_edited)
    if variants:
        chosen = max(variants, key=lambda item: (PRIORITY.get(item["translation_type"], 0), item["ai_edited"]))
        translation_type = chosen["translation_type"]
        ai_edited = chosen["ai_edited"]
    categories = [category]
    for slug, label in CATEGORY_FOLDERS.items():
        if label not in categories and fold(label) in fold(data.get("the loai", "")):
            categories.append(label)
    formats = [compact(value) for value in data.get("dinh dang", "").split()]
    views_digits = re.sub(r"\D", "", data.get("luot xem", ""))
    book = Book(
        id=detail_id(detail_url),
        title=title,
        detail_url=detail_url,
        category=category,
        categories=categories,
        author=data.get("tac gia", ""),
        status=data.get("tinh trang", ""),
        formats=formats,
        translation_type=translation_type,
        ai_edited=ai_edited,
        translator=_named_person(description_text, {"dich gia", "nguoi dich", "nhom dich"}),
        editor=_named_person(description_text, {"editor", "bien tap"}),
        source=data.get("nguon", ""),
        views=int(views_digits) if views_digits else 0,
        tags=_row_links(table, "tu khoa"),
        description=description_text[:12000],
        epub_url=chosen["url"] if variants else "",
        epub_variants=variants,
    )
    return book
