import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from app.translator.reference import TranslationReference
from app.translator.translator import _chunk_fingerprint
from app.config import SETTINGS


class TranslationReferenceTests(unittest.TestCase):
    def _data_dir(self, directory: str) -> Path:
        root = Path(directory) / "QT2025"
        (root / "Names2").mkdir(parents=True)
        (root / "VietPhrase").mkdir()
        (root / "Names.txt").write_text(
            "江凡=Giang Phàm\n司马炎=Tư Mã Viêm\n",
            encoding="utf-8-sig",
        )
        (root / "Names2" / "123.txt").write_text(
            "司马炎=Tư Mã Diễm\n",
            encoding="utf-8-sig",
        )
        (root / "VietPhrase" / "VietPhrase.txt").write_text(
            "太虚神宗=Thái Hư Thần Tông/Thái Hư tông\n"
            "神宗=Thần Tông\n"
            "司马炎=ngọn lửa Tư Mã\n"
            "修炼=tu luyện|rèn luyện\n",
            encoding="utf-8-sig",
        )
        return root

    def test_names2_overrides_names_and_names_win_over_vietphrase(self):
        with tempfile.TemporaryDirectory() as directory:
            reference = TranslationReference.load(self._data_dir(directory))
            entries = reference.find("司马炎开始修炼。")
            by_source = {entry.source: entry for entry in entries}

            self.assertEqual(by_source["司马炎"].kind, "name")
            self.assertEqual(by_source["司马炎"].meanings, ("Tư Mã Diễm",))
            self.assertEqual(by_source["修炼"].meanings, ("tu luyện", "rèn luyện"))

    def test_longest_match_omits_nested_shorter_term(self):
        with tempfile.TemporaryDirectory() as directory:
            reference = TranslationReference.load(self._data_dir(directory))
            sources = {
                entry.source for entry in reference.find("太虚神宗声名远扬。")
            }

            self.assertIn("太虚神宗", sources)
            self.assertNotIn("神宗", sources)

    def test_confirmed_glossary_is_not_repeated_as_reference(self):
        with tempfile.TemporaryDirectory() as directory:
            reference = TranslationReference.load(self._data_dir(directory))
            formatted = reference.format_for_prompt(
                "江凡来到太虚神宗。", {"江凡": "Phương Thần"}
            )

            self.assertNotIn("Giang Phàm", formatted)
            self.assertIn("太虚神宗", formatted)
            self.assertIn("chọn nghĩa theo ngữ cảnh", formatted)

    def test_reference_changes_checkpoint_fingerprint(self):
        first = _chunk_fingerprint("修炼。", {}, "style", "修炼: tu luyện")
        second = _chunk_fingerprint("修炼。", {}, "style", "修炼: rèn luyện")
        self.assertNotEqual(first, second)

    def test_disabled_reference_preserves_legacy_checkpoint_fingerprint(self):
        source = "修炼。"
        glossary = {"江凡": "Phương Thần"}
        style = "style"
        legacy_payload = json.dumps(
            {
                "schema": 2,
                "source": source,
                "glossary": glossary,
                "style": style,
                "model": SETTINGS.gemini_model,
                "repair_model": SETTINGS.gemini_repair_model,
            },
            ensure_ascii=False,
            sort_keys=True,
        )
        legacy = hashlib.sha256(legacy_payload.encode("utf-8")).hexdigest()
        self.assertEqual(_chunk_fingerprint(source, glossary, style), legacy)

    def test_missing_vietphrase_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "VietPhrase"):
                TranslationReference.load(Path(directory))


if __name__ == "__main__":
    unittest.main()
