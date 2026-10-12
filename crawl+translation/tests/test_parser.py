import unittest

from app.crawler.parser import (
    parse_book_page, parse_catalogue_url, parse_chapter_page,
    parse_chapter_page_count, parse_pagination_urls,
)


class ParserTests(unittest.TestCase):
    def test_book_page_order_deduplication_and_pagination(self):
        html = '<a href="123.html">第一章</a><a href="123.html">dup</a><a href="124.html">第二章</a><a href="index_2.html">2</a>'
        chapters = parse_book_page(html, "https://www.97du.cc/1/2/")
        self.assertEqual([item.url for item in chapters], ["https://www.97du.cc/1/2/123.html", "https://www.97du.cc/1/2/124.html"])
        self.assertEqual(parse_pagination_urls(html, "https://www.97du.cc/1/2/"), ["https://www.97du.cc/1/2/index_2.html"])

    def test_prefers_catalogue_over_latest_block(self):
        html = ('<div class="latest"><a href="999.html">最新章</a></div>'
                '<div class="listmain"><dd><a href="1.html">第一章</a></dd>'
                '<dd><a href="2.html">第二章</a></dd></div>')
        chapters = parse_book_page(html, "https://www.97du.cc/1/2/")
        self.assertEqual([chapter.title for chapter in chapters], ["第一章", "第二章"])

    def test_chapter_content_cleanup(self):
        body = "第一段。" * 30
        title, content = parse_chapter_page(f'<h1>第一章</h1><div id="content"><script>x</script>{body}</div>', "url")
        self.assertEqual(title, "第一章"); self.assertEqual(content, body)

    def test_current_97du_containers(self):
        body = "正文内容。" * 30
        title, content = parse_chapter_page(
            f'<h1>第一章-《书名》</h1><article class="font_max">{body}</article>', "url"
        )
        self.assertEqual(title, "第一章-《书名》")
        self.assertEqual(content, body)

    def test_chapter_page_count_and_marker_cleanup(self):
        body = "正文内容。" * 30
        html = f'<h1>第一章</h1><article class="font_max">第(1/3)页\n{body}\n第(1/3)页</article>'
        self.assertEqual(parse_chapter_page_count(html), 3)
        _, content = parse_chapter_page(html, "url")
        self.assertNotIn("第(1/3)页", content)
        self.assertEqual(content, body)

    def test_bqgns_catalogue_pagination_and_chapter(self):
        catalogue_url = "https://www.bqgns.com/book/52413"
        catalogue_html = (
            '<a href="/book/52413/1">开始阅读</a>'
            '<a href="/book/52413/1">第1章 姐姐替嫁</a>'
            '<a href="/book/52413/1577">第1567章 混战</a>'
            '<a href="/book/52413?sort=0&page=3">下一页</a>'
            '<a href="/book/other/1">别的书</a>'
        )
        chapters = parse_book_page(catalogue_html, catalogue_url)
        self.assertEqual(
            [item.title for item in chapters],
            ["第1章 姐姐替嫁", "第1567章 混战"],
        )
        self.assertEqual(
            parse_pagination_urls(catalogue_html, catalogue_url),
            ["https://www.bqgns.com/book/52413?sort=0&page=3"],
        )

        body = "云裳仙子看向江凡。" * 30
        chapter_html = (
            '<h1 class="text_tit">第1567章 混战</h1>'
            f'<div class="text"><p>{body}</p></div>'
        )
        title, content = parse_chapter_page(
            chapter_html, "https://www.bqgns.com/book/52413/1577"
        )
        self.assertEqual(title, "第1567章 混战")
        self.assertEqual(content, body)

    def test_removes_bare_pagination_digit_after_paragraph(self):
        body = "江凡点点头：“借你们绳子用用。”4\n" + "正文内容。" * 30
        _, content = parse_chapter_page(
            f'<h1>第一章</h1><article class="font_max">{body}</article>', "url"
        )
        self.assertIn("江凡点点头：“借你们绳子用用。”\n", content)
        self.assertNotIn("。”4", content)

    def test_biquge_catalogue_and_chapter_input(self):
        chapter_url = "https://www.biquge321.com/zhangjie/188928/265041198.html"
        chapter_html = '<a id="pb_mulu" href="/xiaoshuo/188928/">目录</a>'
        self.assertEqual(
            parse_catalogue_url(chapter_html, chapter_url),
            "https://www.biquge321.com/xiaoshuo/188928/",
        )

        catalogue_html = (
            '<div class="border_left_list"><a href="/zhangjie/188928/9.html">最新</a></div>'
            '<div class="border_chapter"><ul class="fen_4">'
            '<li><a href="/zhangjie/188928/1.html">第1799章 开始</a></li>'
            '<li><a href="/zhangjie/188928/2.html">第1800章 继续</a></li>'
            '</ul></div>'
        )
        chapters = parse_book_page(
            catalogue_html, "https://www.biquge321.com/xiaoshuo/188928/"
        )
        self.assertEqual(
            [chapter.title for chapter in chapters],
            ["第1799章 开始", "第1800章 继续"],
        )

    def test_biquge_content_cleanup(self):
        body = "这是正文内容。" * 30
        html = (
            '<h1>第1799章 开始</h1><div id="txt">'
            '<a>一秒记住【笔趣阁】 biquge321.com，更新快，无弹窗！</a>'
            '第1799章开始(第1/2页)<br>' + body
            + '<br>（本章未完，请点击下一页继续阅读）第1799章开始(第2/2页)<br>'
            + body + '</div>'
        )
        title, content = parse_chapter_page(
            html, "https://www.biquge321.com/zhangjie/188928/265041198.html"
        )
        self.assertEqual(title, "第1799章 开始")
        self.assertEqual(content, body + "\n\n" + body)
        self.assertNotIn("笔趣阁", content)
        self.assertNotIn("第1/2页", content)


if __name__ == "__main__": unittest.main()

