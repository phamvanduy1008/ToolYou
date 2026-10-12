from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1] / "downloads"
INDEX_PATH = ROOT / "danh_sach_epub.json"
LIST_DIR = ROOT / "Danh sách truyện"


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    inventory = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    by_category: dict[str, list[dict[str, object]]] = defaultdict(list)

    for item in inventory.get("files", []):
        category = str(item.get("category", "")).strip()
        if not category:
            continue
        by_category[category].append(
            {
                "title": item.get("title", ""),
                "author": item.get("author", ""),
                "translation_type": item.get("translation_type", "UNKNOWN"),
                "file_name": item.get("name", ""),
                "relative_path": item.get("relative_path", ""),
            }
        )

    LIST_DIR.mkdir(exist_ok=True)
    written = 0
    category_folders = (
        path for path in ROOT.iterdir() if path.is_dir() and path != LIST_DIR
    )
    for folder in sorted(category_folders, key=lambda p: p.name.casefold()):
        stories = by_category.get(folder.name, [])
        stories.sort(key=lambda item: (str(item["title"]).casefold(), str(item["author"]).casefold()))
        payload = {
            "category": folder.name,
            "total_stories": len(stories),
            "titles": [item["title"] for item in stories],
            "stories": stories,
        }
        (LIST_DIR / f"{folder.name}.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        written += 1
        print(f"[OK] {folder.name}: {len(stories)} truyện")

    print(f"[DONE] Đã tạo {written} file trong {LIST_DIR}")


if __name__ == "__main__":
    main()
