import json
import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from app.translator.audit import audit_translations


class TranslationAuditTests(unittest.TestCase):
    def test_explicit_missing_chapters_are_reported_as_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data_dir = root / "data"
            raw_dir = data_dir / "raw" / "book"
            translated_dir = data_dir / "translated" / "book"
            raw_dir.mkdir(parents=True)
            translated_dir.mkdir(parents=True)
            (data_dir / "glossary.json").write_text(
                json.dumps({}, ensure_ascii=False), encoding="utf-8"
            )
            (raw_dir / "934.txt").write_text("正文。" * 100, encoding="utf-8")
            (raw_dir / "987.txt").write_text("正文。" * 100, encoding="utf-8")
            report = root / "audit.txt"

            with (
                patch("app.translator.audit.DATA_DIR", data_dir),
                patch(
                    "app.translator.audit.current_book_directories",
                    return_value=(raw_dir, translated_dir),
                ),
                patch(
                    "app.translator.audit.versioned_translation_directory",
                    return_value=translated_dir,
                ),
            ):
                with redirect_stdout(io.StringIO()):
                    result = audit_translations(
                        chapters={934, 987}, report_path=report
                    )

            contents = report.read_text(encoding="utf-8")
            self.assertEqual(result, 1)
            self.assertIn("Thiếu bản dịch: 2 chương", contents)
            self.assertIn("CHƯƠNG 934: LỖI", contents)
            self.assertIn("CHƯƠNG 987: LỖI", contents)


if __name__ == "__main__":
    unittest.main()
