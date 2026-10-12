from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlsplit

from bs4 import BeautifulSoup

from app.config import DATA_DIR, safe_book_name
from app.storage.json_store import atomic_write_json, read_json


BOOKS_DIR = DATA_DIR / "books"
MANIFESTS_DIR = DATA_DIR / "manifests"
STAGING_DIR = DATA_DIR / "staging"
QUARANTINE_DIR = DATA_DIR / "quarantine"

ERROR_MARKERS = (
    "正在手打中",
    "请稍等片刻",
    "内容更新后，请重新刷新页面",
    "章节内容正在更新",
    "页面不存在",
    "访问过于频繁",
    "人机验证",
    "captcha",
)

NON_STORY_TITLE_MARKERS = (
    "请假", "更新通知", "十点", "十一点", "推迟更新", "晚点更新", "感言",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_key(value: str) -> str:
    key = safe_book_name(value)
    if not re.fullmatch(r"[A-Za-z0-9_-]+", key):
        raise ValueError("Book key must contain only letters, numbers, _ or -")
    return key


def load_book_spec(book_key: str) -> dict[str, Any]:
    path = BOOKS_DIR / f"{safe_key(book_key)}.json"
    if not path.exists():
        raise ValueError(
            f"Missing book config: {path}. Create it before a safe crawl."
        )
    value = read_json(path)
    required = ("book_key", "title_cn", "primary_catalogue_url")
    missing = [name for name in required if not str(value.get(name, "")).strip()]
    if missing:
        raise ValueError(f"Book config is missing: {', '.join(missing)}")
    if safe_key(str(value["book_key"])) != safe_key(book_key):
        raise ValueError("Book config key does not match --book")
    return value


def manifest_dir(book_key: str) -> Path:
    return MANIFESTS_DIR / safe_key(book_key)


def staging_book_dir(book_key: str) -> Path:
    return STAGING_DIR / safe_key(book_key)


def raw_book_dir(book_key: str) -> Path:
    from app.config import RAW_DIR
    return RAW_DIR / safe_key(book_key)


def chapter_number(title: str) -> int | None:
    match = re.search(r"^第\s*(\d+)\s*(?:章)?", title)
    return int(match.group(1)) if match else None


def normalize_title(title: str) -> str:
    value = re.sub(r"\s+", "", title)
    value = re.split(r"[-—–－|丨]\s*[《「『]", value, maxsplit=1)[0]
    value = re.sub(r"[，。！？：；、,.!?:;·~～（）()【】\[\]《》\s]", "", value)
    return value


def is_non_story_title(title: str) -> bool:
    return any(marker in title for marker in NON_STORY_TITLE_MARKERS)


def validate_book_identity(html: str, final_url: str,
                           spec: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    expected_url = str(spec["primary_catalogue_url"])
    expected = urlsplit(expected_url)
    actual = urlsplit(final_url)
    expected_path = expected.path.rstrip("/") + "/"
    actual_path = actual.path.rstrip("/") + "/"
    if actual.netloc.lower() != expected.netloc.lower() or actual_path != expected_path:
        errors.append(f"catalogue redirected outside expected book: {final_url}")
    soup = BeautifulSoup(html, "lxml")
    page_text = soup.get_text(" ", strip=True)
    title = str(spec["title_cn"])
    if title not in page_text:
        errors.append(f"book title not found: {title}")
    author = str(spec.get("author_cn", "")).strip()
    if author and author not in page_text:
        errors.append(f"book author not found: {author}")
    return errors


def catalogue_digest(chapters: list[dict[str, Any]]) -> str:
    payload = json.dumps(chapters, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def validate_catalogue_entries(chapters: list[dict[str, Any]],
                               expected_url: str,
                               allowed_missing: set[int] | None = None) -> list[str]:
    errors: list[str] = []
    expected = urlsplit(expected_url)
    numbers = [int(item["chapter"]) for item in chapters]
    urls = [str(item["url"]) for item in chapters]
    if not chapters:
        return ["catalogue has no chapters"]
    duplicate_numbers = sorted({value for value in numbers if numbers.count(value) > 1})
    duplicate_urls = sorted({value for value in urls if urls.count(value) > 1})
    if duplicate_numbers:
        errors.append("duplicate chapter numbers: " + ", ".join(map(str, duplicate_numbers[:20])))
    if duplicate_urls:
        errors.append("duplicate chapter URLs: " + ", ".join(duplicate_urls[:5]))
    unique = sorted(set(numbers))
    allowed_missing = allowed_missing or set()
    missing = sorted(
        set(range(unique[0], unique[-1] + 1)) - set(unique) - allowed_missing
    )
    if unique[0] != 1:
        errors.append(f"catalogue starts at chapter {unique[0]}, not 1")
    if missing:
        errors.append("missing chapter numbers: " + ", ".join(map(str, missing[:30])))
    for item in chapters:
        number = chapter_number(str(item["title"]))
        if number != int(item["chapter"]):
            errors.append(f"title number mismatch at chapter {item['chapter']}")
            break
        url = urlsplit(str(item["url"]))
        if url.netloc.lower() != expected.netloc.lower() or not url.path.startswith(expected.path.rstrip("/") + "/"):
            errors.append(f"chapter URL outside expected book: {item['url']}")
            break
    return errors


def write_catalogue_snapshot(book_key: str, source_url: str,
                             chapters: list[dict[str, Any]],
                             anomalies: list[dict[str, Any]] | None = None) -> Path:
    directory = manifest_dir(book_key)
    created_at = utc_now()
    payload = {
        "schema_version": 1,
        "book_key": safe_key(book_key),
        "source_url": source_url,
        "created_at": created_at,
        "chapter_count": len(chapters),
        "first_chapter": min(int(item["chapter"]) for item in chapters),
        "last_chapter": max(int(item["chapter"]) for item in chapters),
        "catalogue_sha256": catalogue_digest(chapters),
        "anomalies": anomalies or [],
        "chapters": chapters,
    }
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    snapshot = directory / f"catalogue-{stamp}.json"
    atomic_write_json(snapshot, payload)
    atomic_write_json(directory / "catalogue-latest.json", payload)
    return snapshot


def load_catalogue_snapshot(book_key: str) -> dict[str, Any]:
    path = manifest_dir(book_key) / "catalogue-latest.json"
    if not path.exists():
        raise ValueError(
            f"Missing catalogue snapshot: {path}. Run crawl-catalogue first."
        )
    snapshot = read_json(path)
    chapters = snapshot.get("chapters")
    if not isinstance(chapters, list):
        raise ValueError(f"Invalid catalogue snapshot: {path}")
    digest = catalogue_digest(chapters)
    if digest != snapshot.get("catalogue_sha256"):
        raise ValueError(f"Catalogue snapshot hash mismatch: {path}")
    return snapshot


def content_sha256(text: str) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def han_ratio(text: str) -> float:
    compact = re.sub(r"\s+", "", text)
    if not compact:
        return 0.0
    count = len(re.findall(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]", compact))
    return count / len(compact)


def content_simhash(text: str) -> str:
    """Return a deterministic 64-bit near-duplicate fingerprint."""
    compact = re.sub(r"\s+", "", text)
    shingles = [compact[index:index + 5] for index in range(max(1, len(compact) - 4))]
    weights = [0] * 64
    for shingle in shingles:
        value = int.from_bytes(hashlib.sha256(shingle.encode("utf-8")).digest()[:8], "big")
        for bit in range(64):
            weights[bit] += 1 if value & (1 << bit) else -1
    result = sum(1 << bit for bit, weight in enumerate(weights) if weight >= 0)
    return f"{result:016x}"


def simhash_distance(left: str, right: str) -> int:
    return (int(left, 16) ^ int(right, 16)).bit_count()


def validate_chapter(expected_number: int, catalogue_title: str,
                     page_titles: list[str], content: str,
                     final_urls: list[str], expected_book_url: str,
                     known_hashes: dict[str, int],
                     known_simhashes: dict[str, int] | None = None,
                     ) -> tuple[list[str], dict[str, Any]]:
    errors: list[str] = []
    if not page_titles:
        errors.append("chapter has no page titles")
    for title in page_titles:
        number = chapter_number(title)
        if number != expected_number:
            errors.append(f"H1 chapter mismatch: expected {expected_number}, got {number}: {title}")
    if page_titles:
        expected_title = normalize_title(catalogue_title)
        actual_title = normalize_title(page_titles[0])
        if expected_title and actual_title and expected_title not in actual_title and actual_title not in expected_title:
            errors.append(f"H1 title mismatch: catalogue={catalogue_title!r}, page={page_titles[0]!r}")
    expected = urlsplit(expected_book_url)
    book_path = expected.path.rstrip("/") + "/"
    for final_url in final_urls:
        actual = urlsplit(final_url)
        if actual.netloc.lower() != expected.netloc.lower() or not actual.path.startswith(book_path):
            errors.append(f"redirected outside expected book: {final_url}")
    lowered = content.lower()
    for marker in ERROR_MARKERS:
        if marker.lower() in lowered:
            errors.append(f"error/placeholder marker: {marker}")
    compact_length = len(re.sub(r"\s+", "", content))
    ratio = han_ratio(content)
    if compact_length < 300:
        errors.append(f"content too short: {compact_length} characters")
    if ratio < 0.35:
        errors.append(f"Chinese character ratio too low: {ratio:.3f}")
    digest = content_sha256(content)
    duplicate = known_hashes.get(digest)
    if duplicate is not None and duplicate != expected_number:
        errors.append(f"content duplicates chapter {duplicate}")
    simhash = content_simhash(content)
    for previous_simhash, previous_number in (known_simhashes or {}).items():
        if previous_number != expected_number and simhash_distance(simhash, previous_simhash) <= 3:
            errors.append(f"content nearly duplicates chapter {previous_number}")
            break
    metrics = {
        "content_sha256": digest,
        "content_simhash": simhash,
        "content_chars": len(content.strip()),
        "compact_chars": compact_length,
        "han_ratio": round(ratio, 4),
    }
    return errors, metrics


def chapter_manifest_path(book_key: str) -> Path:
    return manifest_dir(book_key) / "chapters.jsonl"


def load_chapter_records(book_key: str) -> list[dict[str, Any]]:
    path = chapter_manifest_path(book_key)
    if not path.exists():
        return []
    records: list[dict[str, Any]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        value = json.loads(line)
        if not isinstance(value, dict):
            raise ValueError(f"Invalid record at {path}:{line_number}")
        records.append(value)
    return records


def latest_chapter_records(book_key: str) -> dict[int, dict[str, Any]]:
    result: dict[int, dict[str, Any]] = {}
    for record in load_chapter_records(book_key):
        result[int(record["chapter"])] = record
    return result


def write_chapter_records(book_key: str, records: Iterable[dict[str, Any]]) -> None:
    path = chapter_manifest_path(book_key)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as stream:
        for record in records:
            stream.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def upsert_chapter_records(book_key: str,
                           updates: Iterable[dict[str, Any]]) -> None:
    records = latest_chapter_records(book_key)
    for record in updates:
        records[int(record["chapter"])] = record
    write_chapter_records(book_key, (records[number] for number in sorted(records)))
