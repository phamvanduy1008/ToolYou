import json
import re
from pathlib import Path

from app.storage.json_store import atomic_write_json


GLOSSARY_DISCOVERY_PROMPT = """Bạn là biên tập viên tên người cho tiểu thuyết tiên hiệp Trung-Việt.

Chỉ tìm TÊN NGƯỜI MỚI trong nguyên văn tiếng Trung bên dưới.

Quy tắc:
- Không trả lại mục đã có trong glossary.
- Không đổi hoặc đề xuất cách dịch khác cho mục đã có.
- Chỉ lấy cụm chữ Hán xuất hiện nguyên vẹn trong nguyên văn.
- Không lấy địa danh, tông môn, gia tộc, thế lực, cảnh giới, công pháp, võ kỹ,
  pháp bảo, đan dược, chức vụ, danh hiệu hoặc cách gọi theo quan hệ.
- Không lấy các cụm như sư huynh, sư tỷ, trưởng lão, chưởng quỹ, phu nhân,
  công tử, tông chủ hoặc tên gia tộc.
- Tên người Trung Quốc dùng âm Hán-Việt tự nhiên, trừ khi glossary đã quy định khác.
- Chỉ trả JSON hợp lệ, không markdown và không giải thích.
- Mọi mục phải có kind chính xác là person.
- Định dạng chính xác: {{"entries":[{{"source":"朱见深","target":"Chu Kiến Thâm","kind":"person"}}]}}
- Nếu không có mục mới, trả: {{"entries":[]}}

Glossary hiện có:
{glossary}

Nguyên văn:
{text}"""


def load_glossary(path: str | Path) -> dict[str, str]:
    file = Path(path)
    if not file.exists():
        return {}
    with file.open("r", encoding="utf-8") as stream:
        data = json.load(stream)
    if not isinstance(data, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in data.items()):
        raise ValueError("Glossary must be a JSON object of string pairs")
    return data


def format_glossary_for_prompt(glossary: dict[str, str]) -> str:
    return "\n".join(f"{source} = {target}" for source, target in glossary.items()) or "(trống)"


def relevant_glossary(glossary: dict[str, str], source_text: str) -> dict[str, str]:
    """Keep only mappings whose source form occurs in the current raw chunk."""
    return {
        source: target for source, target in glossary.items()
        if source in source_text
    }


def _parse_discovered_entries(response: str, source_text: str,
                              existing: dict[str, str]) -> dict[str, str]:
    """Parse and strictly filter model-proposed glossary entries."""
    cleaned = response.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.I)
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise ValueError("Gemini returned invalid glossary JSON") from exc

    entries = payload.get("entries") if isinstance(payload, dict) else None
    if not isinstance(entries, list):
        raise ValueError("Glossary discovery response must contain an entries list")

    discovered: dict[str, str] = {}
    for item in entries:
        if not isinstance(item, dict):
            continue
        source = str(item.get("source", "")).strip()
        target = str(item.get("target", "")).strip()
        kind = str(item.get("kind", "")).strip().lower()
        if (
            kind != "person"
            or not source or not target or source in existing or source in discovered
            or source not in source_text
            or not re.fullmatch(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff·]{2,6}", source)
            or re.search(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]", target)
            or len(source) > 40 or len(target) > 100
            or not all(word[0].isupper() for word in target.split() if word)
        ):
            continue
        discovered[source] = target
    return discovered


def discover_glossary_entries(client, source_text: str,
                              existing: dict[str, str]) -> dict[str, str]:
    """Ask Gemini only for new person names without changing existing mappings."""
    prompt_glossary = relevant_glossary(existing, source_text)
    prompt = GLOSSARY_DISCOVERY_PROMPT.format(
        glossary=format_glossary_for_prompt(prompt_glossary),
        text=source_text,
    )
    response = client.translate(prompt)
    return _parse_discovered_entries(response, source_text, existing)


def save_glossary(path: str | Path, glossary: dict[str, str]) -> None:
    """Persist glossary updates atomically so an interrupted run cannot corrupt it."""
    atomic_write_json(Path(path), glossary)

