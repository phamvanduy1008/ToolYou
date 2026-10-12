import unittest

from app.translator.translator import build_prompt, load_style_guide


class TranslationPromptTests(unittest.TestCase):
    def test_prompt_contains_project_rules_and_glossary(self):
        prompt = build_prompt(
            "江凡开始修炼。",
            "江凡 = Phương Thần",
            load_style_guide(),
            "Thuật ngữ tham khảo:\n- 修炼: tu luyện | rèn luyện",
        )
        self.assertIn("江凡, Giang Phàm: luôn xuất bản thành Phương Thần", prompt)
        self.assertIn("江凡 = Phương Thần", prompt)
        self.assertIn("江凡开始修炼。", prompt)
        self.assertIn("không mang dấu vết văn convert", prompt)
        self.assertIn("修炼: tu luyện | rèn luyện", prompt)
        self.assertIn("chỉ là gợi ý", prompt)

    def test_prompt_omits_reference_section_when_disabled(self):
        prompt = build_prompt("江凡开始修炼。", "江凡 = Phương Thần", load_style_guide())
        self.assertNotIn("Tham chiếu từ điển", prompt)


if __name__ == "__main__":
    unittest.main()
