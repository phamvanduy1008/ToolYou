"""One-time migration from legacy chapter JSON files to plain TXT files."""

from pathlib import Path
import json
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.storage.json_store import atomic_write_text


def migrate(directory: Path, field: str) -> int:
    migrated = 0
    for source in sorted(directory.glob("*.json")):
        data = json.loads(source.read_text(encoding="utf-8"))
        content = data.get(field)
        if not isinstance(content, str) or not content.strip():
            continue
        target = source.with_suffix(".txt")
        atomic_write_text(target, content)
        source.unlink()
        migrated += 1
    return migrated


if __name__ == "__main__":
    raw = migrate(Path("data/raw"), "content")
    translated = migrate(Path("data/translated"), "content_vi")
    print(f"Migrated raw: {raw}; translated: {translated}")
