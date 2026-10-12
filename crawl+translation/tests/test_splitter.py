import unittest

from app.translator.splitter import split_text


class SplitterTests(unittest.TestCase):
    def test_preserves_every_character(self):
        text = "第一段。还有一句！\n第二段很长？结尾；"
        chunks = split_text(text, 10)
        self.assertEqual("".join(chunks), text)
        self.assertTrue(all(len(chunk) <= 10 for chunk in chunks))
        self.assertEqual("".join(c for c in "".join(chunks) if c in "。！？；"), "。！？；")

    def test_hard_splits_long_sentence(self):
        text = "字" * 31
        chunks = split_text(text, 10)
        self.assertEqual("".join(chunks), text)
        self.assertTrue(all(len(chunk) <= 10 for chunk in chunks))


if __name__ == "__main__": unittest.main()

