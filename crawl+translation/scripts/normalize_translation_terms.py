"""Normalize reviewed terminology variants in existing translation files."""

import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.storage.json_store import atomic_write_text


REPLACEMENTS = {
    "Thiên Cơ các các chủ": "Thiên Cơ các chủ",
    "Thiên Cơ Cát Chủ": "Thiên Cơ các chủ",
    "Thiên Ki Cac Chủ": "Thiên Cơ các chủ",
    "Thiên Ki Cac chủ": "Thiên Cơ các chủ",
    "Thiên Cơ Các Chủ": "Thiên Cơ các chủ",
    "Thiên Ki Các": "Thiên Cơ các",
    "Thiên Cơ Cát": "Thiên Cơ các",
    "Thiên Ki Cac": "Thiên Cơ các",
    "Ki Cac Chủ": "Các chủ",
    "Cac Chủ": "Các chủ",
    "Cac chủ": "các chủ",
    "cac chủ": "các chủ",
}


def normalize_directory(directory: Path) -> list[Path]:
    root = directory.resolve()
    if not root.is_dir():
        raise ValueError(f"Translation directory not found: {root}")
    changed: list[Path] = []
    for path in sorted(root.rglob("*.txt")):
        original = path.read_text(encoding="utf-8")
        updated = original
        for source, target in REPLACEMENTS.items():
            updated = updated.replace(source, target)
        if updated != original:
            atomic_write_text(path, updated)
            changed.append(path)
    return changed


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    repaired = normalize_directory(args.directory)
    print(f"Normalized files: {len(repaired)}")
