"""Optional Quick Translator dictionaries used only as Gemini references.

The dictionaries stay outside this project.  This module reads the user's
local QT2025 directory and extracts only entries that occur in a source chunk;
it never uses the dictionary conversion as the final translation.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path
import re


_MEANING_SEPARATOR = re.compile(r"[/|]")


@dataclass(frozen=True)
class ReferenceEntry:
    source: str
    meanings: tuple[str, ...]
    kind: str
    occurrences: int


def _read_dictionary(path: Path) -> dict[str, str]:
    """Read QT key=value files with BOM handling and first-entry-wins."""
    entries: dict[str, str] = {}
    if not path.exists():
        return entries
    with path.open("r", encoding="utf-8-sig", errors="strict") as stream:
        for raw_line in stream:
            line = raw_line.rstrip("\r\n")
            parts = line.split("=")
            if len(parts) != 2:
                continue
            source, target = (part.strip() for part in parts)
            if source and target and source not in entries:
                entries[source] = target
    return entries


def _meanings(value: str, maximum: int = 4) -> tuple[str, ...]:
    output: list[str] = []
    for item in _MEANING_SEPARATOR.split(value):
        normalized = item.strip()
        if normalized and normalized not in output:
            output.append(normalized)
        if len(output) >= maximum:
            break
    return tuple(output)


class TranslationReference:
    """Read-only, in-memory lookup over selected Quick Translator files."""

    def __init__(self, data_dir: Path, names: dict[str, str],
                 vietphrase: dict[str, str]) -> None:
        self.data_dir = data_dir
        self.names = names
        self.vietphrase = vietphrase
        self._name_lengths = self._length_index(names)
        self._term_lengths = self._length_index(vietphrase)
        self.version = self._dictionary_version(data_dir)

    @classmethod
    def load(cls, data_dir: str | Path) -> "TranslationReference":
        root = Path(data_dir).expanduser()
        if not root.is_dir():
            raise ValueError(f"Quick Translator data directory not found: {root}")

        names = _read_dictionary(root / "Names.txt")
        # QT Names2 overrides Names for the same source key.
        names.update(_read_dictionary(root / "Names2" / "123.txt"))
        vietphrase = _read_dictionary(root / "VietPhrase" / "VietPhrase.txt")
        if not vietphrase:
            raise ValueError(
                "Quick Translator VietPhrase dictionary is missing or empty: "
                f"{root / 'VietPhrase' / 'VietPhrase.txt'}"
            )
        return cls(root, names, vietphrase)

    @staticmethod
    def _length_index(entries: dict[str, str]) -> dict[str, tuple[int, ...]]:
        lengths: dict[str, set[int]] = {}
        for source in entries:
            if len(source) < 2:
                continue
            lengths.setdefault(source[0], set()).add(len(source))
        return {
            first: tuple(sorted(values, reverse=True))
            for first, values in lengths.items()
        }

    @staticmethod
    def _dictionary_version(data_dir: Path) -> str:
        digest = hashlib.sha256()
        for relative in (
            Path("Names.txt"),
            Path("Names2") / "123.txt",
            Path("VietPhrase") / "VietPhrase.txt",
        ):
            path = data_dir / relative
            digest.update(str(relative).replace("\\", "/").encode("utf-8"))
            if path.exists():
                stat = path.stat()
                digest.update(f"{stat.st_size}:{stat.st_mtime_ns}".encode("ascii"))
            else:
                digest.update(b"missing")
        return digest.hexdigest()

    @staticmethod
    def _matches(text: str, entries: dict[str, str],
                 lengths: dict[str, tuple[int, ...]]) -> dict[str, int]:
        """Return longest matches at each source position, deduplicated."""
        found: dict[str, int] = {}
        start = 0
        while start < len(text):
            first = text[start]
            matched = ""
            for length in lengths.get(first, ()):
                end = start + length
                if end > len(text):
                    continue
                candidate = text[start:end]
                if candidate in entries:
                    matched = candidate
                    break
            if matched:
                found[matched] = found.get(matched, 0) + 1
                start += len(matched)
            else:
                start += 1
        return found

    def name_mappings(self, text: str) -> dict[str, str]:
        return {
            source: self.names[source]
            for source in self._matches(text, self.names, self._name_lengths)
        }

    def find(self, text: str, mandatory: dict[str, str] | None = None,
             max_names: int = 20, max_terms: int = 40) -> list[ReferenceEntry]:
        mandatory_sources = set(mandatory or {})
        name_hits = self._matches(text, self.names, self._name_lengths)
        term_hits = self._matches(text, self.vietphrase, self._term_lengths)

        names = [
            ReferenceEntry(source, _meanings(self.names[source]), "name", count)
            for source, count in name_hits.items()
            if source not in mandatory_sources and _meanings(self.names[source])
        ]
        # Exact Names always win over an identically keyed VietPhrase entry.
        terms = [
            ReferenceEntry(source, _meanings(self.vietphrase[source]), "term", count)
            for source, count in term_hits.items()
            if source not in mandatory_sources
            and source not in self.names
            and _meanings(self.vietphrase[source])
        ]
        ranking = lambda item: (-item.occurrences, -len(item.source), item.source)
        names.sort(key=ranking)
        terms.sort(key=ranking)
        return names[:max_names] + terms[:max_terms]

    def format_for_prompt(self, text: str,
                          mandatory: dict[str, str] | None = None,
                          max_names: int = 20,
                          max_terms: int = 40) -> str:
        entries = self.find(text, mandatory, max_names, max_terms)
        if not entries:
            return "(không có)"

        name_lines = [
            f"- {entry.source} = {' | '.join(entry.meanings)}"
            for entry in entries if entry.kind == "name"
        ]
        term_lines = [
            f"- {entry.source}: {' | '.join(entry.meanings)}"
            for entry in entries if entry.kind == "term"
        ]
        sections: list[str] = []
        if name_lines:
            sections.append(
                "Tên riêng tham khảo (không ghi đè Glossary bắt buộc):\n"
                + "\n".join(name_lines)
            )
        if term_lines:
            sections.append(
                "Thuật ngữ tham khảo (chọn nghĩa theo ngữ cảnh, không dịch máy móc):\n"
                + "\n".join(term_lines)
            )
        return "\n\n".join(sections)
