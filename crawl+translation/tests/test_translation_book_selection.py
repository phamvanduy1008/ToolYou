import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.translator import translator


class TranslationBookSelectionTests(unittest.TestCase):
    def test_auto_selects_only_other_book_with_requested_range(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            raw_root = root / "raw"
            translated_root = root / "translated"
            active_raw = raw_root / "new_book"
            old_raw = raw_root / "old_book"
            active_raw.mkdir(parents=True)
            old_raw.mkdir(parents=True)
            (active_raw / "1799.txt").write_text("新" * 101, encoding="utf-8")
            (old_raw / "240.txt").write_text("旧" * 101, encoding="utf-8")
            (old_raw / "500.txt").write_text("旧" * 101, encoding="utf-8")

            with (
                patch.object(translator, "RAW_DIR", raw_root),
                patch.object(translator, "TRANSLATED_DIR", translated_root),
                patch.object(
                    translator,
                    "current_book_directories",
                    return_value=(active_raw, translated_root / "new_book"),
                ),
                patch.object(
                    translator,
                    "versioned_translation_directory",
                    return_value=translated_root / "new_book_v2",
                ),
            ):
                raw, output, selected = translator._resolve_translation_directories(
                    240, 500, None, "v2", None
                )

            self.assertEqual(raw, old_raw)
            self.assertEqual(output, translated_root / "old_book_v2")
            self.assertEqual([path.name for path in selected], ["240.txt", "500.txt"])


if __name__ == "__main__":
    unittest.main()
