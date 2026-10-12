import json
import re
from pathlib import Path
from typing import Any

from app.config import DATA_DIR, current_book_directories
from app.storage.json_store import atomic_write_json, valid_chapter_text
from app.translator.gemini_client import GeminiClient
from app.translator.glossary import format_glossary_for_prompt, load_glossary, save_glossary


CANDIDATES_PATH = DATA_DIR / "glossary_candidates.json"
KINDS = {"person", "place", "sect", "family", "title", "skill", "artifact", "pill", "realm", "other"}
TRAILING_PARTICLES = tuple("的地得了着過过嗎吗呢啊呀吧嘛")

GLOSSARY_BUILD_PROMPT = """Bạn là biên tập viên tên riêng Trung-Việt.

Từ các chương có nhãn bên dưới, hãy trích xuất TOÀN BỘ mục cần dịch nhất quán:
tên người, biệt danh, địa danh, tông môn, gia tộc, thế lực, danh hiệu đặc thù,
công pháp, võ kỹ, pháp bảo, đan dược và cảnh giới riêng.

Quy tắc:
- source phải là cụm chữ Hán xuất hiện nguyên vẹn trong nội dung.
- Tên người dùng âm Hán-Việt chính xác; không dịch nghĩa tùy tiện.
- Không lấy đại từ, động từ, tính từ hoặc danh từ thông thường.
- Không đề xuất lại mục đã có trong glossary chuẩn.
- Chỉ trả JSON hợp lệ, không markdown, theo dạng:
{{"entries":[{{"source":"朱见深","target":"Chu Kiến Thâm","kind":"person"}}]}}
- Không có mục mới thì trả {{"entries":[]}}.

Glossary chuẩn hiện có:
{glossary}

Nội dung:
{content}"""


def _empty_store() -> dict[str, Any]:
    return {"entries": {}, "processed_chapters": []}


def load_candidate_store(path: Path = CANDIDATES_PATH) -> dict[str, Any]:
    if not path.exists():
        return _empty_store()
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or not isinstance(value.get("entries"), dict):
        raise ValueError(f"Invalid glossary candidate store: {path}")
    if not isinstance(value.get("processed_chapters"), list):
        raise ValueError(f"Invalid processed_chapters in: {path}")
    return value


def parse_candidate_response(response: str, sources: dict[int, str],
                             glossary: dict[str, str]) -> list[dict[str, Any]]:
    cleaned = response.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.I)
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise ValueError("Gemini returned invalid glossary candidate JSON") from exc
    items = payload.get("entries") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        raise ValueError("Glossary candidate response must contain entries")

    parsed: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        source = str(item.get("source", "")).strip()
        target = str(item.get("target", "")).strip()
        kind = str(item.get("kind", "other")).strip().lower()
        chapters = [number for number, text in sources.items() if source and source in text]
        if (
            not source or not target or source in glossary or source in seen
            or not chapters
            or source.endswith(TRAILING_PARTICLES)
            or not re.search(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]", source)
            or re.search(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]", target)
            or len(source) > 40 or len(target) > 100
        ):
            continue
        seen.add(source)
        parsed.append({
            "source": source,
            "target": target,
            "kind": kind if kind in KINDS else "other",
            "chapters": chapters,
        })
    return parsed


def merge_candidates(store: dict[str, Any], candidates: list[dict[str, Any]]) -> None:
    entries = store["entries"]
    for candidate in candidates:
        source = candidate["source"]
        target = candidate["target"]
        if source not in entries:
            entries[source] = {
                "target": target,
                "kind": candidate["kind"],
                "chapters": sorted(set(candidate["chapters"])),
                "alternatives": [],
                "status": "pending",
            }
            continue
        current = entries[source]
        current["chapters"] = sorted(set(current.get("chapters", [])) | set(candidate["chapters"]))
        if target != current.get("target") and target not in current.get("alternatives", []):
            current.setdefault("alternatives", []).append(target)


def _chapter_batches(files: list[Path], maximum_chars: int) -> list[list[Path]]:
    batches: list[list[Path]] = []
    current: list[Path] = []
    size = 0
    for path in files:
        length = path.stat().st_size
        if current and size + length > maximum_chars:
            batches.append(current)
            current = []
            size = 0
        current.append(path)
        size += length
    if current:
        batches.append(current)
    return batches


def build_glossary_candidates(start: int | None = None, end: int | None = None,
                              batch_chars: int = 30000) -> None:
    if batch_chars < 2000:
        raise ValueError("--batch-chars must be at least 2000")
    raw_dir, _ = current_book_directories()
    glossary = load_glossary(DATA_DIR / "glossary.json")
    store = load_candidate_store()
    processed = {int(value) for value in store["processed_chapters"]}
    files = sorted(
        (
            path for path in raw_dir.glob("*.txt")
            if path.stem.isdigit()
            and int(path.stem) not in processed
            and (start is None or int(path.stem) >= start)
            and (end is None or int(path.stem) <= end)
        ),
        key=lambda path: int(path.stem),
    )
    client = GeminiClient()
    batches = _chapter_batches(files, batch_chars)
    print(f"Glossary batches: {len(batches)}; chapters pending: {len(files)}")
    for position, batch in enumerate(batches, 1):
        sources: dict[int, str] = {}
        blocks: list[str] = []
        for path in batch:
            if not valid_chapter_text(path):
                raise ValueError(f"Invalid raw chapter: {path}")
            number = int(path.stem)
            text = path.read_text(encoding="utf-8").strip()
            sources[number] = text
            blocks.append(f"[CHAPTER {number}]\n{text}")
        relevant = {
            source: target for source, target in glossary.items()
            if any(source in text for text in sources.values())
        }
        prompt = GLOSSARY_BUILD_PROMPT.format(
            glossary=format_glossary_for_prompt(relevant),
            content="\n\n".join(blocks),
        )
        response = client.translate(prompt)
        candidates = parse_candidate_response(response, sources, glossary)
        merge_candidates(store, candidates)
        processed.update(sources)
        store["processed_chapters"] = sorted(processed)
        atomic_write_json(CANDIDATES_PATH, store)
        print(
            f"[GLOSSARY] batch {position}/{len(batches)} "
            f"chapters {min(sources)}-{max(sources)} added/updated {len(candidates)}"
        )
    print(f"Candidates: {CANDIDATES_PATH}")


def apply_glossary_candidates(approve_unambiguous: bool = False) -> None:
    if approve_unambiguous:
        raise ValueError(
            "--approve-unambiguous is disabled because candidates without alternatives "
            "can still be mistranslated. Review and approve entries manually."
        )
    store = load_candidate_store()
    glossary_path = DATA_DIR / "glossary.json"
    glossary = load_glossary(glossary_path)
    applied = 0
    for source, item in store["entries"].items():
        if item.get("status") != "approved":
            continue
        target = str(item.get("target", "")).strip()
        if not target:
            raise ValueError(f"Approved glossary entry has no target: {source}")
        if source in glossary and glossary[source] != target:
            raise ValueError(f"Refusing to overwrite glossary entry: {source}")
        if source not in glossary:
            glossary[source] = target
            applied += 1
    save_glossary(glossary_path, glossary)
    atomic_write_json(CANDIDATES_PATH, store)
    pending = sum(1 for item in store["entries"].values() if item.get("status") != "approved")
    print(f"Glossary applied: {applied}; pending review: {pending}")


def ensure_glossary_ready(chapters: set[int]) -> None:
    store = load_candidate_store()
    processed = {int(value) for value in store["processed_chapters"]}
    missing = sorted(chapters - processed)
    if missing:
        preview = ", ".join(map(str, missing[:20]))
        raise ValueError(f"Glossary scan is missing selected chapters: {preview}")
    pending = [
        source for source, item in store["entries"].items()
        if item.get("status") != "approved"
        and chapters.intersection(int(value) for value in item.get("chapters", []))
    ]
    if pending:
        raise ValueError(
            "Glossary has pending entries for selected chapters: "
            + ", ".join(pending[:20])
        )
