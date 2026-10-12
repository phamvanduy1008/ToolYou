from __future__ import annotations

import json
import tempfile
import unittest
import zipfile
from argparse import Namespace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from src.downloader import validate_epub
from src.inventory import EpubInventory
from src.models import Book
from src.parser import classify_translation, parse_category, parse_detail
from src.selection import select_preferred
from src.storage import Storage
from src.utils import TRANSLATION_FOLDERS, is_completed, sanitize_filename


def fake_epub(path: Path) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("mimetype", "application/epub+zip")
    return path.stat().st_size


class ParserTests(unittest.TestCase):
    def test_category_only_main_cards_and_mobile_duplicate(self):
        html = '''<div class="noi_dung"><ul><li class="itemtruyen">
          <div class="hide-for-small-only"><div class="tinhtrangtruyen">Hoàn Thành</div>
          <a href="/a_12.html"><h2 class="tensanpham">A</h2></a></div>
          <div class="show-for-small-only"><a href="/a_12.html"><h2 class="tensanpham">A</h2></a></div>
          </li></ul></div><aside><a href="/sidebar_99.html">Hoàn Thành</a></aside>'''
        self.assertEqual(parse_category(html, "https://dtv-ebook.com.vn/huyen-ao-497.html"),
                         [("A", "https://dtv-ebook.com.vn/a_12.html", "Hoàn Thành")])

    def test_detail_ignores_sidebar_and_epub_tag(self):
        html = '''<table><tr><td><h2>Truyện A</h2></td></tr>
          <tr><td><strong>Tác giả</strong></td><td>Tác giả A</td></tr>
          <tr><td><strong>Tình trạng</strong></td><td>Chương 100</td></tr>
          <tr><td><strong>Định dạng</strong></td><td><a href="/tim-kiem.html?keyword=epub">epub</a></td></tr>
          <tr><td><strong>Lượt xem</strong></td><td>2.470</td></tr>
          </table><aside>Hoàn Thành</aside><div id="chitiet">
          <main><a href="/tim-kiem.html?keyword=epub">epub</a></main></div>'''
        book = parse_detail(html, "https://dtv-ebook.com.vn/truyen-a_12.html", "Huyền Ảo")
        self.assertEqual(book.status, "Chương 100")
        self.assertFalse(book.epub_url)
        self.assertFalse(is_completed(book.status))
        self.assertEqual(book.views, 2470)

    def test_translation_and_completion(self):
        self.assertEqual(classify_translation("", "Chương 1 - 1000: người dịch. Chương 1001 - 1500: AI dịch."), "MIXED")
        self.assertEqual(classify_translation("", "Editor: ABC - bản Convert"), "CONVERT")
        self.assertEqual(classify_translation("", "Dịch giả: ABC - AI dịch đã edit"), "AI")
        self.assertFalse(is_completed("CV FULL"))
        self.assertTrue(is_completed("CV FULL", True))

    def test_epub_link_in_separate_tab(self):
        html = '''<table><tr><td><h2>Truyện A</h2></td></tr>
          <tr><td><strong>Tác giả</strong></td><td>Tác giả A</td></tr>
          <tr><td><strong>Tình trạng</strong></td><td>Hoàn Thành</td></tr>
          <tr><td><strong>Định dạng</strong></td><td>epub</td></tr></table>
          <div id="download"><table><tr><td><strong>FULL:</strong>
          <a href="https://docs.google.com/uc?export=download&amp;id=abc">EPUB</a></td></tr></table></div>'''
        book = parse_detail(html, "https://dtv-ebook.com.vn/truyen-a_12.html", "Tiên Hiệp")
        self.assertEqual(book.epub_url, "https://docs.google.com/uc?export=download&id=abc")

    def test_human_epub_wins_within_page(self):
        html = '''<table><tr><td><h2>Truyện A</h2></td></tr>
          <tr><td><strong>Tác giả</strong></td><td>Tác giả A</td></tr>
          <tr><td><strong>Tình trạng</strong></td><td>Hoàn Thành</td></tr></table>
          <div id="download"><table>
          <tr><td><strong>CV FULL:</strong><a href="https://docs.google.com/uc?id=cv">EPUB</a></td></tr>
          <tr><td><strong>AI FULL:</strong><a href="https://docs.google.com/uc?id=ai">EPUB</a></td></tr>
          <tr><td><strong>NGƯỜI DỊCH 8.367:</strong><a href="https://docs.google.com/uc?id=human">EPUB</a></td></tr>
          </table></div>'''
        book = parse_detail(html, "https://dtv-ebook.com.vn/truyen-a_12.html", "Tiên Hiệp")
        self.assertEqual(book.epub_url, "https://docs.google.com/uc?id=human")
        self.assertEqual(book.translation_type, "HUMAN")
        self.assertEqual(len(book.epub_variants), 3)

    def test_filename_windows(self):
        self.assertEqual(sanitize_filename('Tác phẩm: A/B?  '), "Tác phẩm A B")
        self.assertEqual(sanitize_filename("CON"), "_CON")


class StorageTests(unittest.TestCase):
    def test_epub_validation(self):
        with tempfile.TemporaryDirectory() as temp:
            valid = Path(temp) / "valid.epub"
            fake_epub(valid)
            validate_epub(valid)
            invalid = Path(temp) / "invalid.epub"
            invalid.write_text("<html>Google Drive</html>", encoding="utf-8")
            with self.assertRaises(ValueError):
                validate_epub(invalid)

    def test_csv_resume_and_drive_deduplication(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / "downloads" / "AI" / "A.epub"
            fake_epub(path)
            first = Book("12", "A", "https://dtv-ebook.com.vn/a_12.html", "Huyền Ảo", ["Huyền Ảo"])
            first.epub_url = "https://docs.google.com/uc?export=download&id=abc"
            first.file_path = path.relative_to(root).as_posix()
            first.download_status = "SUCCESS"
            Storage(root).upsert(first)
            reopened = Storage(root)
            self.assertTrue(reopened.valid_file(reopened.get("12")))
            self.assertFalse((root / "data" / "downloaded.json").exists())
            second = Book("13", "B", "https://dtv-ebook.com.vn/b_13.html", "Tiên Hiệp", ["Tiên Hiệp"])
            second.epub_url = "https://docs.google.com/uc?export=download&id=abc"
            self.assertEqual(reopened.duplicate(second).id, "12")
            revised = Book("12", "A", first.detail_url, "Huyền Ảo", ["Huyền Ảo"])
            revised.epub_url = "https://docs.google.com/uc?export=download&id=human"
            reopened.upsert(revised)
            self.assertEqual(reopened.get("12").download_status, "PENDING")

    def test_reconcile_moved_epub(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            moved = root / "downloads" / "Tiên Hiệp" / "50_ChuongDau" / "Dịch" / "A.epub"
            fake_epub(moved)
            book = Book("12", "A", "https://dtv-ebook.com.vn/a_12.html", "Tiên Hiệp", ["Tiên Hiệp"])
            book.download_status = "SUCCESS"
            book.file_path = "downloads/Tiên Hiệp/Dịch/A.epub"
            storage = Storage(root)
            storage.upsert(book)
            self.assertEqual(storage.reconcile_moved_files(), 1)
            self.assertTrue(Storage(root).valid_file(Storage(root).get("12")))


class SelectionTests(unittest.TestCase):
    def test_browser_export_imports_detail_html(self):
        import main as app

        html = '''<table><tr><td><h2>Truyện A</h2></td></tr>
          <tr><td><strong>Tác giả</strong></td><td>Tác giả A</td></tr>
          <tr><td><strong>Tình trạng</strong></td><td>Hoàn Thành</td></tr></table>
          <div id="download"><table><tr><td><strong>FULL:</strong>
          <a href="https://docs.google.com/uc?id=abc">EPUB</a></td></tr></table></div>'''
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            export = root / "export.json"
            export.write_text(json.dumps({
                "version": 1,
                "category_url": "https://dtv-ebook.com.vn/xuyen-khong-498.html",
                "details": [{
                    "title": "Truyện A",
                    "url": "https://dtv-ebook.com.vn/truyen-a_12.html",
                    "html": html,
                }],
            }), encoding="utf-8")
            storage = Storage(root)
            seen, unresolved = set(), set()
            counts = {"selected": 0, "downloaded": 0, "already": 0, "skipped": 0, "failed": 0}
            with patch.object(app.console, "print"):
                self.assertFalse(app._scan_browser_export(
                    export, storage, "https://dtv-ebook.com.vn/xuyen-khong-498.html",
                    "Xuyên Không", seen, unresolved, counts,
                ))
            self.assertEqual(seen, {"12"})
            self.assertEqual(storage.get("12").epub_url, "https://docs.google.com/uc?id=abc")
            self.assertEqual(counts["failed"], 0)

    def book(self, book_id: str, title: str, author: str, kind: str) -> Book:
        book = Book(book_id, title, f"https://dtv-ebook.com.vn/a_{book_id}.html", "Tiên Hiệp", ["Tiên Hiệp"])
        book.author = author
        book.translation_type = kind
        book.status = "Hoàn Thành"
        book.epub_url = f"https://docs.google.com/uc?id={book_id}"
        return book

    def test_translation_priority(self):
        ai = self.book("1", "Truyện A (AI dịch)", "Tác giả A", "AI")
        human = self.book("2", "Truyện A", "Tác giả A", "HUMAN")
        cv = self.book("3", "Truyện A (CV)", "Tác giả A", "CONVERT")
        winners, skipped = select_preferred([ai, cv, human])
        self.assertEqual([book.id for book in winners], ["2"])
        self.assertEqual(skipped, {"1": "2", "3": "2"})

    def test_four_output_folders(self):
        self.assertEqual(set(TRANSLATION_FOLDERS.values()), {"Dịch", "AI", "CV", "Chưa xác định"})
        self.assertEqual(TRANSLATION_FOLDERS["MIXED"], "Chưa xác định")

    def test_category_url_selects_category_output_folder(self):
        import main as app

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with patch.object(app, "ROOT", root), patch.object(app.config, "OUTPUT_DIR", str(root / "downloads")):
                with patch.object(app.config, "INPUT_URLS", ["https://dtv-ebook.com.vn/huyen-ao-497.html"]):
                    self.assertEqual(app.settings(), [("huyen-ao", "Huyền Ảo", root / "downloads" / "Huyền Ảo")])
                with patch.object(app.config, "INPUT_URLS", ["https://dtv-ebook.com.vn/tien-hiep-488.html"]):
                    self.assertEqual(app.settings(), [("tien-hiep", "Tiên Hiệp", root / "downloads" / "Tiên Hiệp")])
                with patch.object(app.config, "INPUT_URLS", ["https://dtv-ebook.com.vn/trong-sinh-507.html"]):
                    self.assertEqual(app.settings(), [("trong-sinh", "Trọng Sinh", root / "downloads" / "Trọng Sinh")])

    def test_one_configured_category_and_all_completed_epubs(self):
        import main as app

        class FakeCrawler:
            def category_pages(self, slug, *, max_pages=None):
                assert slug == "tien-hiep"
                yield 1, [(f"Truyện {index}", f"https://dtv-ebook.com.vn/a_{index}.html", "") for index in range(1, 5)]

            def get(self, url):
                return SimpleNamespace(text=url)

        def fake_parse(html, detail_url, category, card_title):
            book_id = detail_url.rsplit("_", 1)[-1].split(".")[0]
            title = "Truyện A" if book_id in {"1", "2"} else f"Truyện {book_id}"
            kind = {"1": "AI", "2": "HUMAN", "3": "CONVERT", "4": "MIXED"}[book_id]
            book = self.book(book_id, title, "Tác giả A", kind)
            book.category = category
            book.categories = [category]
            if book_id == "3":
                book.status = "Chương 100"
            return book

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            output = root / "downloads" / "Tiên Hiệp"
            downloaded: list[str] = []

            def fake_download(book, destination, session):
                downloaded.append(book.id)
                return fake_epub(destination)

            args = Namespace(from_csv=False, scan_only=False, resume=False, max_pages=None, max_books=None)
            with patch.object(app, "ROOT", root), patch.object(app, "arguments", return_value=args), \
                 patch.object(app, "settings", return_value=[("tien-hiep", "Tiên Hiệp", output)]), \
                 patch.object(app, "Crawler", FakeCrawler), patch.object(app, "parse_detail", side_effect=fake_parse), \
                 patch.object(app, "download_epub", side_effect=fake_download):
                self.assertEqual(app.main(), 0)
            self.assertEqual(set(downloaded), {"2", "4"})
            self.assertTrue((output / "Dịch").is_dir())
            self.assertTrue((output / "AI").is_dir())
            self.assertTrue((output / "CV").is_dir())
            self.assertTrue((output / "Chưa xác định").is_dir())
            storage = Storage(root)
            self.assertEqual(storage.get("1").download_status, "SKIPPED")
            self.assertEqual(storage.get("3").download_status, "NOT_COMPLETED")
            self.assertTrue(storage.get("2").file_path.startswith("downloads/Tiên Hiệp/Dịch/"))
            self.assertTrue(storage.get("4").file_path.startswith("downloads/Tiên Hiệp/Chưa xác định/"))
            self.assertFalse((root / "data" / "top50.csv").exists())

    def test_from_csv_skips_valid_download(self):
        import main as app

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            output = root / "downloads" / "Tiên Hiệp"
            old = self.book("1", "Truyện cũ", "Tác giả A", "HUMAN")
            path = output / "50_ChuongDau" / "Dịch" / "Truyện cũ.epub"
            fake_epub(path)
            old.file_path = path.relative_to(root).as_posix()
            old.download_status = "SUCCESS"
            storage = Storage(root)
            storage.upsert(old)
            storage.upsert(self.book("2", "Truyện mới", "Tác giả B", "AI"))
            downloaded: list[str] = []

            def fake_download(book, destination, session):
                downloaded.append(book.id)
                return fake_epub(destination)

            args = Namespace(from_csv=True, scan_only=False, resume=False, max_pages=None, max_books=None)
            with patch.object(app, "ROOT", root), patch.object(app, "arguments", return_value=args), \
                 patch.object(app, "settings", return_value=[("tien-hiep", "Tiên Hiệp", output)]), \
                 patch.object(app, "download_epub", side_effect=fake_download):
                self.assertEqual(app.main(), 0)
            self.assertEqual(downloaded, ["2"])
            self.assertTrue(Storage(root).get("2").file_path.startswith("downloads/Tiên Hiệp/AI/"))

    def test_later_page_replaces_ai_only_after_human_download(self):
        import main as app

        class FakeCrawler:
            def category_pages(self, slug, *, max_pages=None):
                yield 1, [("Truyện A (AI dịch)", "https://dtv-ebook.com.vn/a_1.html", "Hoàn Thành")]
                yield 2, [("Truyện A", "https://dtv-ebook.com.vn/a_2.html", "Hoàn Thành")]

            def get(self, url):
                return SimpleNamespace(text=url)

        def fake_parse(html, detail_url, category, card_title):
            book_id = detail_url.rsplit("_", 1)[-1].split(".")[0]
            book = self.book(book_id, card_title, "Tác giả A", "AI" if book_id == "1" else "HUMAN")
            book.category = category
            book.categories = [category]
            return book

        for fail_human in (False, True):
            with self.subTest(fail_human=fail_human), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                output = root / "downloads" / "Tiên Hiệp"
                events = []

                def fake_download(book, destination, session):
                    if book.id == "2" and fail_human:
                        raise ValueError("download failed")
                    if book.id == "2":
                        self.assertTrue(any(event == "ai_downloaded" for event in events))
                        self.assertTrue(any(output.joinpath("AI").glob("*.epub")))
                    size = fake_epub(destination)
                    events.append("ai_downloaded" if book.id == "1" else "human_downloaded")
                    return size

                args = Namespace(from_csv=False, scan_only=False, resume=False, max_pages=None, max_books=None)
                with patch.object(app, "ROOT", root), patch.object(app, "arguments", return_value=args), \
                     patch.object(app, "settings", return_value=[("tien-hiep", "Tiên Hiệp", output)]), \
                     patch.object(app, "Crawler", FakeCrawler), patch.object(app, "parse_detail", side_effect=fake_parse), \
                     patch.object(app, "download_epub", side_effect=fake_download):
                    self.assertEqual(app.main(), 1 if fail_human else 0)
                storage = Storage(root)
                self.assertEqual(storage.get("1").download_status, "SUCCESS" if fail_human else "SKIPPED")
                self.assertEqual(len(list((output / "AI").glob("*.epub"))), 1 if fail_human else 0)
                self.assertEqual(len(list((output / "Dịch").glob("*.epub"))), 0 if fail_human else 1)

    def test_global_inventory_skips_same_full_book_in_huyen_ao(self):
        import main as app

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            downloads = root / "downloads"
            kept = downloads / "Tiên Hiệp" / "Dịch" / "Truyện A - Tác giả A.epub"
            fake_epub(kept)
            storage = Storage(root)
            inventory = EpubInventory(downloads, storage)
            candidate = self.book("20", "Truyện A", "Tác giả A", "AI")
            candidate.category = "Huyền Ảo"
            counts = {"already": 0, "downloaded": 0, "failed": 0}
            with patch.object(app, "ROOT", root), patch.object(app, "download_epub") as download:
                app._download(candidate, storage, None, counts, downloads / "Huyền Ảo", inventory)
                download.assert_not_called()
            self.assertEqual(counts["already"], 1)
            self.assertTrue(kept.is_file())
            self.assertEqual(storage.get("20").file_path, kept.relative_to(root).as_posix())
            self.assertEqual(inventory.path.name, "danh_sach_epub.json")

    def test_partial_tien_hiep_does_not_block_full_huyen_ao(self):
        import main as app

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            downloads = root / "downloads"
            partial = downloads / "Tiên Hiệp" / "50_ChuongDau" / "AI" / "Truyện A - Tác giả A.epub"
            fake_epub(partial)
            storage = Storage(root)
            inventory = EpubInventory(downloads, storage)
            candidate = self.book("20", "Truyện A", "Tác giả A", "HUMAN")
            candidate.category = "Huyền Ảo"
            counts = {"already": 0, "downloaded": 0, "failed": 0}

            def fake_download(book, destination, session):
                return fake_epub(destination)

            with patch.object(app, "ROOT", root), patch.object(app, "download_epub", side_effect=fake_download):
                app._download(candidate, storage, None, counts, downloads / "Huyền Ảo", inventory)
            self.assertEqual(counts["downloaded"], 1)
            self.assertTrue(partial.is_file())
            self.assertEqual(len(inventory.files), 2)

    def test_cleanup_removes_only_full_huyen_duplicate(self):
        import main as app

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            downloads = root / "downloads"
            tien = downloads / "Tiên Hiệp" / "Dịch" / "Truyện A - Tác giả A.epub"
            huyen = downloads / "Huyền Ảo" / "AI" / "Truyện A - Tác giả A.epub"
            partial = downloads / "Huyền Ảo" / "Con_Lai" / "AI" / "Truyện A - Tác giả A.epub"
            for path in (tien, huyen, partial):
                fake_epub(path)
            storage = Storage(root)
            book = self.book("20", "Truyện A", "Tác giả A", "AI")
            book.file_path = huyen.relative_to(root).as_posix()
            book.download_status = "SUCCESS"
            storage.upsert(book)
            inventory = EpubInventory(downloads, storage)
            with patch.object(app, "ROOT", root), patch.object(app.console, "print"):
                self.assertEqual(app._remove_huyen_duplicates(storage, inventory), 1)
            self.assertTrue(tien.is_file())
            self.assertTrue(partial.is_file())
            self.assertFalse(huyen.exists())
            self.assertEqual(Storage(root).get("20").download_status, "SKIPPED")
            self.assertEqual(len(inventory.files), 2)


if __name__ == "__main__":
    unittest.main()
