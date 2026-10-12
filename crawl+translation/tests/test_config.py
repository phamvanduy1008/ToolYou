import unittest

from app.config import safe_book_name, versioned_translation_directory

class ConfigTests(unittest.TestCase):
    def test_book_folder_uses_underscores_between_words(self):
        self.assertEqual(safe_book_name("Thái Hư Chí Tôn"), "Thai_Hu_Chi_Ton")

    def test_book_folder_remains_windows_safe(self):
        self.assertEqual(safe_book_name("Tên: Truyện / Mới"), "Ten__Truyen___Moi")

    def test_versioned_translation_directory_is_separate(self):
        default = versioned_translation_directory()
        versioned = versioned_translation_directory("v2")
        self.assertEqual(versioned.parent, default.parent)
        self.assertEqual(versioned.name, default.name + "_v2")

    def test_rejects_unsafe_translation_version(self):
        with self.assertRaises(ValueError):
            versioned_translation_directory("../v2")


if __name__ == "__main__":
    unittest.main()
