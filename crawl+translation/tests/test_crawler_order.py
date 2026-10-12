import unittest

from app.crawler.crawler import _number_chapters, _order_chapters_by_title
from app.models import Chapter


class CrawlerOrderTests(unittest.TestCase):
    def test_orders_paginated_catalogue_by_explicit_chapter_number(self):
        chapters = [
            Chapter(1, "第1章 开始", "https://example/1.html"),
            Chapter(2, "第3章 后续", "https://example/3.html"),
            Chapter(3, "第2章 中间", "https://example/2.html"),
        ]

        ordered = _order_chapters_by_title(chapters)

        self.assertEqual([chapter.title for chapter in ordered], [
            "第1章 开始", "第2章 中间", "第3章 后续",
        ])

    def test_collapses_duplicate_chapter_numbers(self):
        chapters = [
            Chapter(1, "第1章 开始", "https://example/1.html"),
            Chapter(2, "第1章 重复", "https://example/duplicate.html"),
        ]

        self.assertEqual(len(_order_chapters_by_title(chapters)), 1)

    def test_ignores_non_chapter_catalogue_links(self):
        chapters = [
            Chapter(1, "第1章 开始", "https://example/1.html"),
            Chapter(2, "作品相关", "https://example/about.html"),
        ]

        ordered = _order_chapters_by_title(chapters)

        self.assertEqual([chapter.title for chapter in ordered], ["第1章 开始"])

    def test_biquge_preserves_links_when_a_title_number_is_duplicated(self):
        chapters = [
            Chapter(1, "第1章 开始", "https://www.biquge321.com/zhangjie/8/1.html"),
            Chapter(2, "第3章 网站误标", "https://www.biquge321.com/zhangjie/8/2.html"),
            Chapter(3, "第3章 继续", "https://www.biquge321.com/zhangjie/8/3.html"),
        ]

        numbered = _number_chapters(
            chapters, "https://www.biquge321.com/xiaoshuo/8/"
        )

        self.assertEqual([chapter.index for chapter in numbered], [1, 2, 3])
        self.assertEqual(len(numbered), 3)


if __name__ == "__main__":
    unittest.main()
