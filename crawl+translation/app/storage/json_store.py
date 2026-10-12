import json
import os
import re
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any


CONVERT_PHRASES = (
    "nhất khỏa", "một hữu", "kính nhiên",
    "bất cảm trí tín", "thử thời", "thử khắc",
    "tự kỷ", "đảo hấp nhất khẩu", "thuyết trước",
    "tắc thị", "dĩ kinh", "khán trước", "nã xuất", "tài toán thị",
    "ký nhiên", "chân chính đích", "đích diện dung", "đích thoại",
)

CONVERT_TOKEN_RE = re.compile(
    r"\b(?:đích|nhĩ|khán|tòng|chẩm)\b",
)

CHINESE_DIGITS = {"零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3,
                  "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
CHINESE_UNITS = {"十": 10, "百": 100, "千": 1000, "万": 10_000, "亿": 100_000_000}
VI_DIGITS = ("không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín")


def _parse_chinese_number(value: str) -> int | None:
    total = section = number = 0
    try:
        for character in value:
            if character in CHINESE_DIGITS:
                number = CHINESE_DIGITS[character]
                continue
            unit = CHINESE_UNITS[character]
            if unit < 10_000:
                section += (number or 1) * unit
            else:
                section = (section + number) * unit
                total += section
                section = 0
            number = 0
    except KeyError:
        return None
    return total + section + number


def _read_vietnamese_under_1000(number: int, full: bool = False) -> str:
    hundreds, remainder = divmod(number, 100)
    parts: list[str] = []
    if hundreds or full:
        parts.extend((VI_DIGITS[hundreds], "trăm"))
    tens, ones = divmod(remainder, 10)
    if tens > 1:
        parts.extend((VI_DIGITS[tens], "mươi"))
        if ones == 1:
            parts.append("mốt")
        elif ones == 5:
            parts.append("lăm")
        elif ones:
            parts.append(VI_DIGITS[ones])
    elif tens == 1:
        parts.append("mười")
        if ones == 5:
            parts.append("lăm")
        elif ones:
            parts.append(VI_DIGITS[ones])
    elif ones:
        if parts:
            parts.append("lẻ")
        parts.append(VI_DIGITS[ones])
    return " ".join(parts)


def _number_to_vietnamese(number: int) -> str:
    if number == 0:
        return "không"
    groups: list[int] = []
    remaining = number
    while remaining:
        groups.append(remaining % 1000)
        remaining //= 1000
    labels = ("", "nghìn", "triệu", "tỷ", "nghìn tỷ", "triệu tỷ")
    parts: list[str] = []
    for position in range(len(groups) - 1, -1, -1):
        group = groups[position]
        if not group:
            continue
        parts.append(_read_vietnamese_under_1000(group, full=bool(parts) and group < 100))
        if position:
            parts.append(labels[position])
    return " ".join(parts)


def _number_to_vietnamese_forms(number: int) -> set[str]:
    """Return exact Vietnamese literary forms for a numeric value."""
    words = _number_to_vietnamese(number)
    forms = {words, words.replace("nghìn", "ngàn")}
    forms.update(form[4:] for form in list(forms) if form.startswith("một "))

    # Common literary forms that preserve the exact value but do not resemble
    # modern decimal readings.
    if number == 20:
        forms.add("đôi mươi")
    if number >= 10_000 and number % 10_000 == 0:
        ten_thousands = number // 10_000
        prefix = _number_to_vietnamese(ten_thousands)
        forms.add(f"{prefix} vạn")
        if ten_thousands == 1:
            forms.add("vạn")
    return forms


def find_number_mismatches(source_text: str, translated_text: str) -> list[str]:
    """Find explicit Chinese numbers whose value disappeared from the translation."""
    mismatches: list[str] = []
    digit_values = {
        int(match.group(0))
        for match in re.finditer(r"(?<!\d)\d+(?!\d)", source_text)
        # Some source mirrors inject bare pagination/navigation digits between
        # punctuation (for example ``。3。，``). They are not story quantities
        # and must not force the translation to invent a matching number.
        if not (
            source_text[max(0, match.start() - 1):match.start()]
            in "。！？!?…，、；："
            and source_text[match.end():match.end() + 1]
            in "。！？!?…，、；："
        )
    }
    chinese_values: dict[str, int] = {}
    for match in re.finditer(r"[零〇一二两三四五六七八九十百千万亿]+", source_text):
        raw = match.group(0)
        preceding = source_text[max(0, match.start() - 1):match.start()]
        following = source_text[match.end():match.end() + 1]
        suffix = source_text[match.end():match.end() + 2]
        # Chinese monetary/classifier expressions commonly use 万/两 and are
        # rendered as "vạn/lượng", which cannot be compared by a cheap lexical
        # check. Restrict hard validation to explicit time/age quantities.
        if following not in {"岁", "年", "月", "日", "天", "倍"}:
            continue
        # 三十六天罡 is a named group/term, not a duration of 36 days.
        if suffix == "天罡":
            continue
        # In 十年为单位 ("measured in decades"), 十年 describes
        # a scale rather than one exact ten-year duration. A natural
        # translation may therefore say "hàng chục năm".
        if raw == "十" and source_text.startswith("年为单位", match.end()):
            continue
        if preceding in {"数", "几"}:
            continue
        # 千百 and longer forms such as 千百万 are literary approximations
        # ("hundreds or thousands", "countless"), not exact positional
        # numerals. Parsing 千百 as 1000 + 100 creates a false requirement
        # that the translation contain the exact value 1100.
        if raw.startswith("千百"):
            continue
        if not re.search(r"[十百千万亿]", raw):
            continue
        value = _parse_chinese_number(raw)
        if value is not None and value >= 10:
            chinese_values[raw] = value
    target_lower = translated_text.casefold()
    target_digit_values = {
        int(value.replace(".", "").replace(",", ""))
        for value in re.findall(r"(?<!\d)\d[\d.,]*(?!\d)", translated_text)
        if value.replace(".", "").replace(",", "").isdigit()
    }
    for raw, value in chinese_values.items():
        forms = _number_to_vietnamese_forms(value)
        if value not in target_digit_values and not any(form in target_lower for form in forms):
            mismatches.append(f"{raw}={value}")
    for value in digit_values:
        if value not in target_digit_values:
            forms = _number_to_vietnamese_forms(value)
            if not any(form in target_lower for form in forms):
                mismatches.append(str(value))
    return sorted(set(mismatches))


def find_convert_markers(text: str) -> list[str]:
    """Return strong signs that a result is Chinese read in Sino-Vietnamese."""
    lowered = text.casefold()
    markers = [
        phrase for phrase in CONVERT_PHRASES
        if re.search(rf"(?<!\w){re.escape(phrase)}(?!\w)", lowered)
    ]
    token_hits: list[str] = []
    for match in CONVERT_TOKEN_RE.finditer(text):
        token = match.group(0)
        before = text[max(0, match.start() - 8):match.start()].casefold()
        after = text[match.end():match.end() + 8].casefold()
        if token == "đích" and (
            before.endswith("mục ")
            or after.startswith((" thân", " thực", " đến", " danh"))
        ):
            continue
        if token == "nhĩ" and before.endswith("thú "):
            continue
        token_hits.append(token)
    word_count = max(1, len(re.findall(r"\b\w+\b", text, flags=re.UNICODE)))
    if len(token_hits) >= 5 and len(token_hits) / word_count >= 0.0025:
        markers.append(f"mật độ từ convert cao ({len(token_hits)}/{word_count})")
    return markers


def _find_suspicious_name_pairs(text: str,
                                glossary: dict[str, str]) -> set[tuple[str, str]]:
    """Return (variant, canonical) pairs for multiword glossary names."""
    word_matches = list(re.finditer(r"[^\W\d_]+", text, flags=re.UNICODE))
    candidates_by_length: dict[int, set[str]] = {}

    def candidates_of_length(length: int) -> set[str]:
        if length not in candidates_by_length:
            found: set[str] = set()
            for start in range(len(word_matches) - length + 1):
                group = word_matches[start:start + length]
                if not all(match.group(0)[0].isupper() for match in group):
                    continue
                if not all(
                    text[left.end():right.start()].isspace()
                    for left, right in zip(group, group[1:])
                ):
                    continue
                found.add(" ".join(match.group(0) for match in group))
            candidates_by_length[length] = found
        return candidates_by_length[length]

    canonical_names = set(glossary.values())
    # Do not treat a suffix/prefix inside an already-correct full name as a
    # separate near miss. Example: "Vân Hi" inside "Nhiếp Vân Hi" must not
    # be normalized toward the distinct glossary name "Vân Nhi".
    protected_subnames: set[str] = set()
    for full_name in canonical_names:
        words = full_name.split()
        if len(words) < 3 or not re.search(
            rf"(?<!\w){re.escape(full_name)}(?!\w)", text
        ):
            continue
        for length in range(2, len(words)):
            for start in range(len(words) - length + 1):
                protected_subnames.add(" ".join(words[start:start + length]))

    suspicious: set[tuple[str, str]] = set()
    for canonical in canonical_names:
        canonical_words = canonical.split()
        # Lower-case glossary phrases are ordinary terms/cultivation levels, not
        # proper names. Comparing them fuzzily against title-cased prose creates
        # false positives such as "Luyện Khí Cửu" vs "Luyện khí dịch".
        if (
            len(canonical_words) < 2
            or not all(word and word[0].isupper() for word in canonical_words)
        ):
            continue
        for candidate in candidates_of_length(len(canonical_words)):
            candidate_words = candidate.split()
            shares_middle_name = (
                len(canonical_words) >= 3
                and len(candidate_words) == len(canonical_words)
                and candidate_words[1].casefold() == canonical_words[1].casefold()
            )
            if (
                candidate not in canonical_names
                and candidate not in protected_subnames
                and len(candidate_words) == len(canonical_words)
                and candidate_words[0].casefold() == canonical_words[0].casefold()
                and (
                    shares_middle_name
                    or SequenceMatcher(
                        None, candidate.casefold(), canonical.casefold()
                    ).ratio() >= (0.90 if len(canonical_words) == 2 else 0.84)
                )
            ):
                suspicious.add((candidate, canonical))
    return suspicious


def find_suspicious_name_variants(text: str,
                                  glossary: dict[str, str]) -> list[str]:
    """Find near-miss spellings of multiword Vietnamese glossary names."""
    return sorted(
        f"{candidate} (gần với {canonical})"
        for candidate, canonical in _find_suspicious_name_pairs(text, glossary)
    )


def normalize_suspicious_name_variants(
    text: str, glossary: dict[str, str]
) -> tuple[str, dict[str, str]]:
    """Fix unambiguous Latin-script name variants without an LLM repair call.

    Candidates containing Han characters are deliberately excluded: replacing
    such a candidate could delete untranslated prose attached to a name.
    """
    matches: dict[str, set[str]] = {}
    for candidate, canonical in _find_suspicious_name_pairs(text, glossary):
        letters = [character for character in candidate if character.isalpha()]
        if not letters or not all(
            "LATIN" in unicodedata.name(character, "") for character in letters
        ):
            continue
        matches.setdefault(candidate, set()).add(canonical)

    replacements = {
        candidate: next(iter(canonicals))
        for candidate, canonicals in matches.items()
        if len(canonicals) == 1
    }
    normalized = text
    for candidate, canonical in sorted(
        replacements.items(), key=lambda item: len(item[0]), reverse=True
    ):
        normalized = re.sub(
            rf"(?<!\w){re.escape(candidate)}(?!\w)", canonical, normalized
        )
    return normalized, replacements


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as stream:
        value = json.load(stream)
    if not isinstance(value, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return value


def atomic_write_json(path: Path, data: dict[str, Any]) -> None:
    """Atomically save UTF-8 JSON beside its final destination."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def atomic_write_text(path: Path, text: str) -> None:
    """Atomically save normalized UTF-8 text."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip() + "\n"
    with temporary.open("w", encoding="utf-8", newline="\n") as stream:
        stream.write(normalized)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def chapter_path(directory: Path, index: int) -> Path:
    return directory / f"{index}.json"


def chapter_text_path(directory: Path, index: int) -> Path:
    return directory / f"{index}.txt"


def valid_chapter_text(path: Path) -> bool:
    try:
        return path.suffix == ".txt" and len(path.read_text(encoding="utf-8").strip()) > 100
    except OSError:
        return False


def validate_vietnamese_translation(text: str, require_min_length: bool = True,
                                    glossary: dict[str, str] | None = None,
                                    source_text: str | None = None) -> list[str]:
    """Return quality errors that make a translated chapter unsafe to publish."""
    errors: list[str] = []
    if require_min_length and len(text.strip()) <= 100:
        errors.append("content is too short")
    han_count = len(re.findall(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]", text))
    if han_count:
        errors.append(f"contains {han_count} Chinese characters")
    if re.search(r"\bGiang\s+Phàm\b", text, flags=re.IGNORECASE):
        errors.append("contains forbidden name Giang Phàm")
    if "Vương Vượng Phượng" in text or "Vương V映凤" in text:
        errors.append("contains incorrect name for Vương Ánh Phượng")
    convert_markers = find_convert_markers(text)
    if convert_markers:
        errors.append("contains convert language: " + ", ".join(convert_markers[:8]))
    if glossary:
        # When source context is available, compare fuzzy spellings only with
        # glossary names that actually occur in this source segment. Comparing
        # against the entire book glossary makes unrelated similar names create
        # false positives and prevents deterministic normalization.
        contextual_glossary = (
            {
                source: target
                for source, target in glossary.items()
                if source in source_text
            }
            if source_text else glossary
        )
        name_variants = find_suspicious_name_variants(text, contextual_glossary)
        if name_variants:
            errors.append("contains suspicious name variants: " + ", ".join(name_variants[:8]))
    if source_text:
        number_mismatches = find_number_mismatches(source_text, text)
        if number_mismatches:
            errors.append("number mismatch: " + ", ".join(number_mismatches[:12]))
    return errors


def valid_translation_text(path: Path, glossary: dict[str, str] | None = None) -> bool:
    try:
        return path.suffix == ".txt" and not validate_vietnamese_translation(
            path.read_text(encoding="utf-8"), glossary=glossary
        )
    except OSError:
        return False


def valid_translation_chunk(path: Path, glossary: dict[str, str] | None = None) -> bool:
    try:
        text = path.read_text(encoding="utf-8")
        return bool(text.strip()) and not validate_vietnamese_translation(
            text, require_min_length=False, glossary=glossary
        )
    except OSError:
        return False


def valid_raw(path: Path) -> bool:
    try:
        item = read_json(path)
        return (
            isinstance(item.get("index"), int) and item["index"] > 0
            and bool(str(item.get("url", "")).strip())
            and bool(str(item.get("title", "")).strip())
            and len(str(item.get("content", "")).strip()) > 100
            and item.get("status") == "crawled"
        )
    except (OSError, ValueError, json.JSONDecodeError):
        return False


def valid_translation(path: Path) -> bool:
    try:
        item = read_json(path)
        return (
            isinstance(item.get("index"), int) and item["index"] > 0
            and bool(str(item.get("title_vi", "")).strip())
            and bool(str(item.get("content_vi", "")).strip())
            and item.get("status") == "translated"
        )
    except (OSError, ValueError, json.JSONDecodeError):
        return False

