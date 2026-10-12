import logging
from pathlib import Path

from app.config import DATA_DIR, versioned_translation_directory
from app.storage.json_store import read_json, valid_translation_text
from app.translator.glossary import load_glossary


def export_txt(output: Path, allow_missing: bool = False,
               version: str | None = None) -> None:
    translated_book_dir = versioned_translation_directory(version)
    glossary = load_glossary(DATA_DIR / "glossary.json")
    files = [
        path for path in sorted(translated_book_dir.glob("*.txt"))
        if valid_translation_text(path, glossary)
    ]
    if not files:
        raise ValueError("No valid translated chapters found")
    chapters = [(int(path.stem), path.read_text(encoding="utf-8").strip()) for path in files]
    indexes = [index for index, _ in chapters]
    missing = sorted(set(range(min(indexes), max(indexes) + 1)) - set(indexes))
    if missing:
        logging.warning("Missing translated chapter indexes: %s", ", ".join(map(str, missing)))
        if not allow_missing:
            logging.warning("Export continues; use --allow-missing to explicitly accept gaps")
    book = read_json(DATA_DIR / "book.json")
    title = book.get("title_vi") or book.get("title_cn") or "NOVEL"
    parts = [str(title)]
    for index, content in chapters:
        parts.extend((f"Chương {index}", content))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n\n".join(parts) + "\n", encoding="utf-8")
    print(f"Exported {len(chapters)} chapters to {output}")

