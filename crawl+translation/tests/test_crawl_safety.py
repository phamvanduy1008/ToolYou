import unittest

from app.crawler.safety import (
    chapter_number,
    content_sha256,
    content_simhash,
    normalize_title,
    validate_book_identity,
    validate_catalogue_entries,
    validate_chapter,
)


class CrawlSafetyTests(unittest.TestCase):
    def setUp(self):
        self.book_url = "https://www.97du.cc/105/105308/"
        self.spec = {
            "title_cn": "太虚至尊",
            "author_cn": "苍天霸主",
            "primary_catalogue_url": self.book_url,
        }

    def test_extracts_and_normalizes_chapter_title(self):
        self.assertEqual(chapter_number("第 301 章 标题"), 301)
        self.assertEqual(chapter_number("第2289 异变"), 2289)
        self.assertEqual(
            normalize_title("第301章 标题-《太虚至尊》"),
            normalize_title("第301章 标题"),
        )

    def test_book_identity_rejects_wrong_book_and_redirect(self):
        html = "<h1>别的书</h1><p>别的作者</p>"
        errors = validate_book_identity(
            html, "https://www.97du.cc/134/134799/", self.spec
        )
        self.assertGreaterEqual(len(errors), 3)

    def test_catalogue_rejects_gap_duplicate_and_foreign_url(self):
        entries = [
            {"chapter": 1, "title": "第1章 一", "url": self.book_url + "1.html"},
            {"chapter": 1, "title": "第1章 重复", "url": self.book_url + "2.html"},
            {"chapter": 3, "title": "第3章 三", "url": "https://other/3.html"},
        ]
        errors = validate_catalogue_entries(entries, self.book_url)
        self.assertTrue(any("duplicate chapter" in error for error in errors))
        self.assertTrue(any("missing chapter" in error for error in errors))
        self.assertTrue(any("outside expected book" in error for error in errors))

    def test_chapter_rejects_wrong_h1_placeholder_and_duplicate(self):
        content = "正在手打中，请稍等片刻。" + "正文内容。" * 100
        digest = content_sha256(content)
        errors, metrics = validate_chapter(
            301,
            "第301章 正确标题",
            ["第302章 错误标题"],
            content,
            [self.book_url + "123.html"],
            self.book_url,
            {digest: 99},
        )
        self.assertEqual(metrics["content_sha256"], digest)
        self.assertTrue(any("H1 chapter mismatch" in error for error in errors))
        self.assertTrue(any("placeholder" in error for error in errors))
        self.assertTrue(any("duplicates chapter 99" in error for error in errors))

    def test_valid_chapter_passes(self):
        content = "江凡看向远方。" * 100
        errors, _ = validate_chapter(
            301,
            "第301章 正确标题",
            ["第301章 正确标题-《太虚至尊》"],
            content,
            [self.book_url + "123.html"],
            self.book_url,
            {},
        )
        self.assertEqual(errors, [])

    def test_near_duplicate_is_rejected(self):
        original = "江凡看向远方。" * 100
        changed = original + "。"
        errors, _ = validate_chapter(
            302,
            "第302章 正确标题",
            ["第302章 正确标题"],
            changed,
            [self.book_url + "124.html"],
            self.book_url,
            {},
            {content_simhash(original): 301},
        )
        self.assertTrue(any("nearly duplicates chapter 301" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
