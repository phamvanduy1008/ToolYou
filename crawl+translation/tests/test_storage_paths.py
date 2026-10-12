import unittest
from pathlib import Path

from app.storage.json_store import chapter_path, chapter_text_path


class StoragePathTests(unittest.TestCase):
    def test_chapter_paths_are_not_zero_padded(self):
        directory = Path("book")
        self.assertEqual(chapter_text_path(directory, 1), directory / "1.txt")
        self.assertEqual(chapter_path(directory, 12), directory / "12.json")


if __name__ == "__main__":
    unittest.main()
