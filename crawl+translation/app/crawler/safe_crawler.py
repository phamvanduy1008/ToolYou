from __future__ import annotations

import json
import logging
import re
import statistics
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from bs4 import BeautifulSoup

from app.config import DATA_DIR
from app.crawler.client import AccessDeniedError, HttpClient
from app.crawler.parser import (
    parse_book_page,
    parse_chapter_page,
    parse_chapter_page_count,
    parse_pagination_urls,
)
from app.crawler.safety import (
    content_sha256,
    is_non_story_title,
    latest_chapter_records,
    load_book_spec,
    load_catalogue_snapshot,
    manifest_dir,
    normalize_title,
    raw_book_dir,
    safe_key,
    staging_book_dir,
    upsert_chapter_records,
    utc_now,
    validate_book_identity,
    validate_catalogue_entries,
    validate_chapter,
    write_catalogue_snapshot,
)
from app.storage.json_store import atomic_write_json, atomic_write_text, valid_chapter_text


def _chapter_subpage_url(url: str, page: int) -> str:
    if page == 1:
        return url
    if not url.endswith(".html"):
        raise ValueError(f"Unsupported chapter URL for pagination: {url}")
    return f"{url[:-5]}_{page}.html"


def _run_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _collect_catalogue(client: HttpClient, book_url: str,
                       spec: dict) -> tuple[str, list[dict], list[dict]]:
    first = client.get_response(book_url)
    identity_errors = validate_book_identity(first.text, first.final_url, spec)
    if identity_errors:
        raise ValueError("Book identity check failed: " + "; ".join(identity_errors))
    canonical_url = str(spec["primary_catalogue_url"])
    page_html: dict[str, str] = {canonical_url: first.text}
    queued = parse_pagination_urls(first.text, canonical_url)
    visited: set[str] = set()
    while queued:
        page_url = queued.pop(0)
        if page_url in visited:
            continue
        visited.add(page_url)
        response = client.get_response(page_url)
        expected = urlsplit(canonical_url)
        actual = urlsplit(response.final_url)
        if actual.netloc.lower() != expected.netloc.lower():
            raise ValueError(f"Catalogue page redirected to another domain: {response.final_url}")
        page_html[page_url] = response.text
        for candidate in parse_pagination_urls(response.text, canonical_url):
            if candidate not in visited and candidate not in queued:
                queued.append(candidate)
        queued.sort(key=lambda value: _catalogue_page_number(value))

    entries: list[dict] = []
    seen_urls: set[str] = set()
    for page_url in sorted(page_html, key=_catalogue_page_number):
        for chapter in parse_book_page(page_html[page_url], canonical_url):
            match = re.search(r"^第\s*(\d+)\s*(?:章)?", chapter.title)
            if match is None or chapter.url in seen_urls:
                continue
            seen_urls.add(chapter.url)
            entries.append({
                "chapter": int(match.group(1)),
                "title": chapter.title,
                "url": chapter.url,
                "catalogue_page": page_url,
                "kind": "notice" if is_non_story_title(chapter.title) else "story",
            })
    grouped: dict[int, list[dict]] = {}
    for entry in entries:
        grouped.setdefault(int(entry["chapter"]), []).append(entry)
    resolved: list[dict] = []
    anomalies: list[dict] = []
    for number in sorted(grouped):
        choices = grouped[number]
        if len(choices) == 1:
            resolved.append(choices[0])
            continue
        normalized_titles = {normalize_title(str(item["title"])) for item in choices}
        if len(normalized_titles) == 1:
            kept = min(
                choices,
                key=lambda item: int(re.search(r"/(\d+)/?$", str(item["url"])).group(1)),
            )
            resolved.append(kept)
            anomalies.append({
                "type": "duplicate_alias_resolved",
                "chapter": number,
                "kept": kept,
                "ignored": [item for item in choices if item is not kept],
            })
            continue
        ranked = sorted(choices, key=lambda item: len(normalize_title(str(item["title"]))), reverse=True)
        if len(normalize_title(str(ranked[0]["title"]))) == len(normalize_title(str(ranked[1]["title"]))):
            resolved.extend(choices)
            continue
        resolved.append(ranked[0])
        anomalies.append({
            "type": "duplicate_number_resolved",
            "chapter": number,
            "kept": ranked[0],
            "ignored": ranked[1:],
        })
    entries = sorted(resolved, key=lambda item: int(item["chapter"]))
    allowed_missing = {int(value) for value in spec.get("allowed_missing_chapters", [])}
    actual_numbers = {int(item["chapter"]) for item in entries}
    for number in sorted(allowed_missing - actual_numbers):
        anomalies.append({
            "type": "allowed_missing_non_story_chapter",
            "chapter": number,
            "reason": "configured official notice omitted by primary mirror",
        })
    errors = validate_catalogue_entries(entries, canonical_url, allowed_missing)
    if errors:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        atomic_write_json(
            manifest_dir(str(spec["book_key"])) / f"catalogue-rejected-{stamp}.json",
            {"created_at": utc_now(), "source_url": canonical_url,
             "errors": errors, "anomalies": anomalies, "chapters": entries},
        )
        raise ValueError("Catalogue validation failed: " + "; ".join(errors))
    return canonical_url, entries, anomalies


def _catalogue_page_number(url: str) -> int:
    parts = urlsplit(url)
    match = re.search(r"index_(\d+)\.html$", parts.path)
    if match:
        return int(match.group(1))
    page = parse_qs(parts.query).get("page", ["0"])[0]
    return int(page) if page.isdigit() else 0


def _reference_titles(html: str) -> dict[int, str]:
    soup = BeautifulSoup(html, "lxml")
    result: dict[int, str] = {}
    for node in soup.select("a"):
        title = node.get_text(" ", strip=True)
        match = re.search(r"第\s*(\d+)\s*章\s*(.+)", title)
        if match:
            number = int(match.group(1))
            if number not in result or len(normalize_title(title)) > len(normalize_title(result[number])):
                result[number] = title
    return result


def _snapshot_references(client: HttpClient, book_key: str,
                         spec: dict, primary_entries: list[dict]) -> dict:
    sources: list[dict] = []
    for url in spec.get("reference_urls", []):
        try:
            response = client.get_response(str(url))
            titles = _reference_titles(response.text)
            sources.append({
                "url": str(url),
                "final_url": response.final_url,
                "chapter_count_parsed": len(titles),
                "titles": {str(number): title for number, title in sorted(titles.items())},
                "error": None,
            })
        except Exception as exc:  # A reference outage must not corrupt the primary snapshot.
            sources.append({"url": str(url), "error": str(exc), "titles": {}})

    comparisons: list[dict] = []
    for item in primary_entries:
        number = int(item["chapter"])
        primary_title = normalize_title(str(item["title"]))
        matches = []
        conflicts = []
        for source in sources:
            reference = source.get("titles", {}).get(str(number))
            if not reference:
                continue
            if normalize_title(reference) == primary_title:
                matches.append(source["url"])
            else:
                conflicts.append({"url": source["url"], "title": reference})
        status = "verified" if matches else ("conflict" if conflicts else "primary_only")
        comparisons.append({
            "chapter": number,
            "status": status,
            "matching_sources": matches,
            "conflicts": conflicts,
        })
    payload = {"created_at": utc_now(), "sources": sources, "comparisons": comparisons}
    atomic_write_json(manifest_dir(book_key) / "reference-catalogue.json", payload)
    return payload


def crawl_catalogue(book_key: str, url: str | None = None) -> Path:
    spec = load_book_spec(book_key)
    expected_url = str(spec["primary_catalogue_url"])
    if url and url.rstrip("/") != expected_url.rstrip("/"):
        raise ValueError(
            f"--url does not match configured primary source: {expected_url}"
        )
    client = HttpClient()
    source_url, entries, anomalies = _collect_catalogue(client, expected_url, spec)
    snapshot = write_catalogue_snapshot(book_key, source_url, entries, anomalies)
    references = _snapshot_references(client, book_key, spec, entries)
    verified = sum(item["status"] == "verified" for item in references["comparisons"])
    conflicts = sum(item["status"] == "conflict" for item in references["comparisons"])
    print(
        f"Catalogue snapshot: {snapshot}\n"
        f"Chapters: {len(entries)}\n"
        f"Catalogue anomalies documented: {len(anomalies)}\n"
        f"Reference verified: {verified}\n"
        f"Reference conflicts: {conflicts}"
    )
    return snapshot


def _fetch_complete_chapter(client: HttpClient, chapter: dict,
                            stage_dir: Path) -> tuple[list[str], str, list[str], list[str]]:
    url = str(chapter["url"])
    first = client.get_response(url)
    if first.content_type and "html" not in first.content_type.lower():
        raise ValueError(f"Unexpected content type {first.content_type}: {url}")
    atomic_write_text(stage_dir / "page-1.html", first.text)
    first_title, first_content = parse_chapter_page(first.text, first.final_url)
    page_count = parse_chapter_page_count(first.text)
    if page_count < 1 or page_count > 20:
        raise ValueError(f"Unreasonable chapter page count {page_count}: {url}")
    titles = [first_title]
    contents = [first_content]
    requested_urls = [url]
    final_urls = [first.final_url]
    for page in range(2, page_count + 1):
        page_url = _chapter_subpage_url(url, page)
        response = client.get_response(page_url)
        if response.content_type and "html" not in response.content_type.lower():
            raise ValueError(f"Unexpected content type {response.content_type}: {page_url}")
        atomic_write_text(stage_dir / f"page-{page}.html", response.text)
        title, content = parse_chapter_page(response.text, response.final_url)
        titles.append(title)
        contents.append(content)
        requested_urls.append(page_url)
        final_urls.append(response.final_url)
    return titles, "\n\n".join(contents), requested_urls, final_urls


def crawl_from_snapshot(book_key: str, start: int | None, end: int | None,
                        force: bool = False, staging_only: bool = False,
                        continue_on_error: bool = False) -> None:
    key = safe_key(book_key)
    spec = load_book_spec(key)
    snapshot = load_catalogue_snapshot(key)
    selected = [
        item for item in snapshot["chapters"]
        if (start is None or int(item["chapter"]) >= start)
        and (end is None or int(item["chapter"]) <= end)
    ]
    if not selected:
        raise ValueError("No chapters selected from catalogue snapshot")
    client = HttpClient()
    run_id = _run_id()
    run_dir = staging_book_dir(key) / run_id
    raw_dir = raw_book_dir(key)
    previous = latest_chapter_records(key)
    reference_status: dict[int, dict] = {}
    approved_reference_conflicts = {
        int(number): details
        for number, details in spec.get("approved_reference_conflicts", {}).items()
    }
    reference_path = manifest_dir(key) / "reference-catalogue.json"
    if reference_path.exists():
        reference_payload = json.loads(reference_path.read_text(encoding="utf-8"))
        reference_status = {
            int(item["chapter"]): item
            for item in reference_payload.get("comparisons", [])
        }
    known_hashes = {
        str(record.get("content_sha256")): number
        for number, record in previous.items()
        if record.get("content_sha256") and record.get("status") in {"verified", "staged"}
    }
    known_simhashes = {
        str(record.get("content_simhash")): number
        for number, record in previous.items()
        if record.get("content_simhash") and record.get("status") in {"verified", "staged"}
    }
    updates: list[dict] = []
    success = skipped = failed = 0
    last_failure_signature = ""
    consecutive_same_failures = 0
    print(f"Snapshot chapters: {snapshot['chapter_count']}\nSelected: {len(selected)}\nRun: {run_id}")
    for position, chapter in enumerate(selected, 1):
        number = int(chapter["chapter"])
        raw_path = raw_dir / f"{number}.txt"
        old = previous.get(number, {})
        if not force and valid_chapter_text(raw_path) and old.get("status") == "verified":
            actual_hash = content_sha256(raw_path.read_text(encoding="utf-8"))
            if actual_hash == old.get("content_sha256"):
                skipped += 1
                print(f"[{position}/{len(selected)}] {number:06d} SKIP verified")
                continue
        stage_dir = run_dir / str(number)
        base_record = {
            "schema_version": 1,
            "chapter": number,
            "catalogue_title": chapter["title"],
            "source_url": chapter["url"],
            "catalogue_snapshot_sha256": snapshot["catalogue_sha256"],
            "run_id": run_id,
            "staging_path": str(stage_dir.relative_to(DATA_DIR.parent)),
            "crawled_at": utc_now(),
        }
        if chapter.get("kind") == "notice":
            record = {
                **base_record,
                "status": "non_story",
                "checks": [],
                "notice_title": chapter["title"],
            }
            upsert_chapter_records(key, [record])
            skipped += 1
            print(f"[{position}/{len(selected)}] {number:06d} SKIP non-story notice")
            continue
        try:
            titles, content, requested_urls, final_urls = _fetch_complete_chapter(
                client, chapter, stage_dir
            )
            errors, metrics = validate_chapter(
                number,
                str(chapter["title"]),
                titles,
                content,
                final_urls,
                str(spec["primary_catalogue_url"]),
                known_hashes,
                known_simhashes,
            )
            reference = reference_status.get(number)
            if (
                reference and reference.get("status") == "conflict"
                and number not in approved_reference_conflicts
            ):
                errors.append("catalogue title conflicts with reference source")
            atomic_write_text(stage_dir / "content.txt", content)
            record = {
                **base_record,
                "page_title": titles[0] if titles else "",
                "page_titles": titles,
                "subpage_urls": requested_urls,
                "final_urls": final_urls,
                **metrics,
                "checks": errors,
                "status": "quarantined" if errors else ("staged" if staging_only else "verified"),
            }
            if number in approved_reference_conflicts:
                record["reference_conflict_resolution"] = approved_reference_conflicts[number]
            atomic_write_json(stage_dir / "record.json", record)
            updates.append(record)
            if errors:
                failed += 1
                print(f"[{position}/{len(selected)}] {number:06d} QUARANTINE {'; '.join(errors)}")
                signature = errors[0].split(":", 1)[0]
                if signature == last_failure_signature:
                    consecutive_same_failures += 1
                else:
                    last_failure_signature = signature
                    consecutive_same_failures = 1
                if consecutive_same_failures >= 3:
                    print("Circuit breaker: stopped after 3 consecutive matching validation failures")
                    break
                if not continue_on_error:
                    break
                continue
            known_hashes[metrics["content_sha256"]] = number
            known_simhashes[metrics["content_simhash"]] = number
            last_failure_signature = ""
            consecutive_same_failures = 0
            if not staging_only:
                atomic_write_text(raw_path, content)
            success += 1
            print(f"[{position}/{len(selected)}] {number:06d} {'STAGED' if staging_only else 'OK'} {titles[0]}")
        except AccessDeniedError:
            if updates:
                upsert_chapter_records(key, updates)
            raise
        except Exception as exc:
            failed += 1
            record = {**base_record, "status": "failed", "checks": [str(exc)]}
            atomic_write_json(stage_dir / "record.json", record)
            updates.append(record)
            logging.exception("[SAFE CRAWL] %06d ERROR %s", number, exc)
            print(f"[{position}/{len(selected)}] {number:06d} ERROR {exc}")
            signature = type(exc).__name__
            if signature == last_failure_signature:
                consecutive_same_failures += 1
            else:
                last_failure_signature = signature
                consecutive_same_failures = 1
            if consecutive_same_failures >= 3:
                print("Circuit breaker: stopped after 3 consecutive matching errors")
                break
            if not continue_on_error:
                break
        finally:
            if updates:
                upsert_chapter_records(key, updates)
                updates.clear()
    print(f"Finished\nSuccess: {success}\nSkipped: {skipped}\nFailed/quarantined: {failed}")


def _selected(number: int, start: int | None, end: int | None) -> bool:
    return (start is None or number >= start) and (end is None or number <= end)


def audit_crawl(book_key: str, start: int | None = None,
                end: int | None = None, output: Path | None = None,
                reference: str | None = None) -> int:
    key = safe_key(book_key)
    spec = load_book_spec(key)
    approved_reference_conflicts = {
        int(number) for number in spec.get("approved_reference_conflicts", {})
    }
    snapshot = load_catalogue_snapshot(key)
    records = latest_chapter_records(key)
    raw_dir = raw_book_dir(key)
    selected_entries = [
        item for item in snapshot["chapters"]
        if _selected(int(item["chapter"]), start, end)
    ]
    lengths = [
        int(records[int(item["chapter"])].get("content_chars", 0))
        for item in selected_entries
        if records.get(int(item["chapter"]), {}).get("content_chars")
    ]
    median = statistics.median(lengths) if lengths else 0
    errors = 0
    lines = [
        f"# Crawl audit — {key}", "",
        f"- Catalogue SHA-256: `{snapshot['catalogue_sha256']}`",
        f"- Selected chapters: {len(selected_entries)}",
        f"- Median content length: {median:g}",
        f"- Reference mode: {reference or 'manifest only'}", "",
        "| Chapter | Status | Title | URL | SHA-256 | Notes |",
        "|---:|---|---|---|---|---|",
    ]
    reference_data = {}
    reference_path = manifest_dir(key) / "reference-catalogue.json"
    if reference_path.exists():
        value = json.loads(reference_path.read_text(encoding="utf-8"))
        reference_data = {int(item["chapter"]): item for item in value.get("comparisons", [])}
    for entry in selected_entries:
        number = int(entry["chapter"])
        record = records.get(number)
        notes: list[str] = []
        status = "missing"
        digest = ""
        if record:
            status = str(record.get("status", "unknown"))
            digest = str(record.get("content_sha256", ""))
            notes.extend(map(str, record.get("checks", [])))
            path = raw_dir / f"{number}.txt"
            if status == "verified":
                if not path.exists():
                    notes.append("verified manifest but raw file is missing")
                elif content_sha256(path.read_text(encoding="utf-8")) != digest:
                    notes.append("raw hash differs from manifest")
            length = int(record.get("content_chars", 0))
            if median and length and (length < median * 0.35 or length > median * 2.8):
                notes.append(f"length outlier: {length}")
        else:
            legacy_path = raw_dir / f"{number}.txt"
            if legacy_path.exists():
                status = "untracked_raw"
                digest = content_sha256(legacy_path.read_text(encoding="utf-8"))
                notes.append("raw exists without provenance manifest; recrawl before relying on it")
        ref = reference_data.get(number)
        if (
            reference and ref and ref.get("status") == "conflict"
            and number not in approved_reference_conflicts
        ):
            notes.append("reference title conflict")
        if status not in {"verified", "staged", "non_story"} or notes:
            errors += 1
        title = str(entry["title"]).replace("|", "\\|")
        url = str(entry["url"])
        lines.append(
            f"| {number} | {status} | {title} | {url} | `{digest[:12]}` | "
            + "; ".join(notes).replace("|", "\\|") + " |"
        )
    lines.extend(["", f"Errors/warnings: **{errors}**", ""])
    lines.extend(["## Content previews", ""])
    for entry in selected_entries:
        number = int(entry["chapter"])
        record = records.get(number, {})
        content_path: Path | None = None
        raw_path = raw_dir / f"{number}.txt"
        if raw_path.exists():
            content_path = raw_path
        elif record.get("staging_path"):
            candidate = DATA_DIR.parent / str(record["staging_path"]) / "content.txt"
            if candidate.exists():
                content_path = candidate
        if content_path is None:
            continue
        compact = re.sub(r"\s+", " ", content_path.read_text(encoding="utf-8")).strip()
        first = compact[:200].replace("`", "'")
        last = compact[-200:].replace("`", "'")
        lines.extend([
            f"### Chapter {number}", "",
            f"- First: `{first}`", f"- Last: `{last}`", "",
        ])
    target = output or DATA_DIR.parent / "logs" / f"crawl_audit_{key}.md"
    atomic_write_text(target, "\n".join(lines))
    print(f"Audit report: {target}\nErrors/warnings: {errors}")
    return 1 if errors else 0


def commit_staged(book_key: str, start: int | None = None,
                  end: int | None = None) -> None:
    key = safe_key(book_key)
    records = latest_chapter_records(key)
    raw_dir = raw_book_dir(key)
    updates: list[dict] = []
    committed = 0
    for number in sorted(records):
        if not _selected(number, start, end):
            continue
        record = records[number]
        if record.get("status") != "staged":
            continue
        stage_dir = DATA_DIR.parent / str(record["staging_path"])
        content_path = stage_dir / "content.txt"
        if not content_path.exists():
            raise ValueError(f"Missing staged content for chapter {number}: {content_path}")
        content = content_path.read_text(encoding="utf-8")
        if content_sha256(content) != record.get("content_sha256"):
            raise ValueError(f"Staged hash mismatch for chapter {number}")
        if record.get("checks"):
            raise ValueError(f"Chapter {number} still has validation errors")
        atomic_write_text(raw_dir / f"{number}.txt", content)
        updated = dict(record)
        updated["status"] = "verified"
        updated["committed_at"] = utc_now()
        updates.append(updated)
        committed += 1
    if updates:
        upsert_chapter_records(key, updates)
    print(f"Committed staged chapters: {committed}")
