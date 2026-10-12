import tempfile
import unittest
from pathlib import Path

from app.config import SETTINGS
from app.storage.json_store import (
    normalize_suspicious_name_variants, validate_vietnamese_translation,
    valid_translation_text,
)
from app.storage.json_store import find_number_mismatches
from app.translator.translator import (
    _chunk_fingerprint, _clean_and_validate_translation, _strip_valid_segment_ids,
    _group_source_segments, _normalize_source_text, _tag_source_segments,
    _translate_validated_chunk,
)
from app.translator.gemini_client import (
    GeminiContentBlockedError, GeminiRecitationError,
)


class TranslationValidationTests(unittest.TestCase):
    def test_normalizes_reviewed_source_typo(self):
        self.assertEqual(
            _normalize_source_text("冷清楚还在愣神中。"),
            "冷青竹还在愣神中。",
        )

    def test_rejects_chinese_and_forbidden_name(self):
        errors = validate_vietnamese_translation("Giang Phàm gặp Vương V映凤." * 20)
        self.assertTrue(any("Chinese" in error for error in errors))
        self.assertTrue(any("Giang Phàm" in error for error in errors))

    def test_applies_fixed_protagonist_name(self):
        text = ("Giang Phàm bắt đầu tu luyện. " * 20).strip()
        cleaned = _clean_and_validate_translation(text)
        self.assertNotIn("Giang Phàm", cleaned)
        self.assertIn("Phương Thần", cleaned)

    def test_normalizes_tien_co_cac_master_title(self):
        cleaned = _clean_and_validate_translation(
            "Thiên Ki Cac Chủ bước vào đại điện. " * 10,
            {"天机阁主": "Thiên Cơ các chủ"},
            "天机阁主走进大殿。",
        )
        self.assertNotIn("Thiên Ki Cac Chủ", cleaned)
        self.assertIn("Thiên Cơ các chủ", cleaned)

        variants = _clean_and_validate_translation(
            "Thiên Cơ Cát Chủ gặp Thiên Ki Các. " * 10,
            {"天机阁主": "Thiên Cơ các chủ"},
        )
        self.assertNotIn("Thiên Cơ Cát", variants)
        self.assertNotIn("Thiên Ki Các", variants)
        self.assertIn("Thiên Cơ các chủ", variants)

    def test_valid_translation_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "1.txt"
            path.write_text("Phương Thần bắt đầu tu luyện. " * 20, encoding="utf-8")
            self.assertTrue(valid_translation_text(path))

    def test_rejects_convert_language(self):
        text = (
            "Thử thời thử khắc, tha vọng trước nhất khỏa đan dược, "
            "mãn nhãn đô thị bất cảm trí tín. " * 10
        )
        errors = validate_vietnamese_translation(text)
        self.assertTrue(any("convert language" in error for error in errors))

    def test_rejects_near_miss_glossary_name(self):
        text = "Vương Vánh Phượng bước vào đại sảnh. " * 10
        errors = validate_vietnamese_translation(
            text, glossary={"王映凤": "Vương Ánh Phượng"}
        )
        self.assertTrue(any("name variants" in error for error in errors))

    def test_rejects_changed_name_with_single_letter_middle_name(self):
        text = "Hứa U Thư đứng phía sau đám đông. " * 10
        errors = validate_vietnamese_translation(
            text, glossary={"许悠然": "Hứa U Nhiên"}
        )
        self.assertTrue(any("Hứa U Thư" in error for error in errors))

    def test_normalizes_unambiguous_glossary_name_variant(self):
        normalized, replacements = normalize_suspicious_name_variants(
            "Hứa Du Nhiên bước vào đại sảnh.",
            {"许悠然": "Hứa U Nhiên"},
        )
        self.assertEqual(normalized, "Hứa U Nhiên bước vào đại sảnh.")
        self.assertEqual(replacements, {"Hứa Du Nhiên": "Hứa U Nhiên"})

    def test_does_not_normalize_name_joined_to_chinese_residue(self):
        text = "Hứa U Nhiên也面露古怪之色"
        normalized, replacements = normalize_suspicious_name_variants(
            text, {"许悠然": "Hứa U Nhiên"}
        )
        self.assertEqual(normalized, text)
        self.assertEqual(replacements, {})

    def test_does_not_normalize_part_of_exact_longer_name(self):
        text = "Nhiếp Vân Hi mỉm cười với mọi người."
        glossary = {
            "芸儿": "Vân Nhi",
            "聂云曦": "Nhiếp Vân Hi",
            "聂云卓": "Nhiếp Vân Trác",
        }
        normalized, replacements = normalize_suspicious_name_variants(
            text, glossary
        )
        self.assertEqual(normalized, text)
        self.assertEqual(replacements, {})
        errors = validate_vietnamese_translation(
            text, require_min_length=False, glossary=glossary
        )
        self.assertFalse(any("name variants" in error for error in errors))

    def test_does_not_reject_natural_vietnamese_convert_homonyms(self):
        text = (
            "Mục đích thực sự của hắn là đích thân đến Hải Thị. "
            "Sau cú ngã, hắn trình bày một giả thuyết khác. " * 10
        )
        errors = validate_vietnamese_translation(text)
        self.assertFalse(any("convert language" in error for error in errors))

    def test_does_not_reject_another_canonical_similar_name(self):
        text = "Phương Hàn gặp Phương Thần tại đại điện. " * 10
        errors = validate_vietnamese_translation(
            text,
            glossary={"江凡": "Phương Thần", "方寒": "Phương Hàn"},
        )
        self.assertFalse(any("name variants" in error for error in errors))

    def test_source_context_disambiguates_similar_glossary_names(self):
        glossary = {
            "冷青竹": "Lãnh Thanh Trúc",
            "冷清楚": "Lãnh Thanh Trúc",
            "冷青云": "Lãnh Thanh Vân",
        }
        cleaned = _clean_and_validate_translation(
            "Lãnh Thanh Sơ vẫn còn đang ngẩn người.",
            glossary,
            "冷清楚还在愣神中。",
        )
        self.assertEqual(cleaned, "Lãnh Thanh Trúc vẫn còn đang ngẩn người.")

    def test_does_not_compare_title_cased_prose_with_lowercase_term(self):
        text = "Hắn đã bước vào Luyện Khí Cửu Tầng. " * 10
        errors = validate_vietnamese_translation(
            text, glossary={"极品练气液": "Luyện khí dịch"}
        )
        self.assertFalse(any("name variants" in error for error in errors))

    def test_detects_changed_chinese_number(self):
        mismatches = find_number_mismatches(
            "他们在十八岁时成婚。", "Hai người sẽ kết hôn vào năm mươi tuổi."
        )
        self.assertIn("十八=18", mismatches)

    def test_ignores_bare_digit_injected_between_punctuation(self):
        mismatches = find_number_mismatches(
            "回头狠狠瞪了眼空气。一住。3。，心里喝道。",
            "Hắn quay đầu trừng mắt vào khoảng không rồi quát thầm.",
        )
        self.assertEqual(mismatches, [])

    def test_still_checks_meaningful_arabic_digit(self):
        mismatches = find_number_mismatches(
            "他连续等了3天。", "Hắn liên tục chờ hai ngày."
        )
        self.assertIn("3", mismatches)

    def test_accepts_translated_chinese_number_words(self):
        mismatches = find_number_mismatches(
            "他们在十八岁时成婚。", "Hai người sẽ kết hôn vào năm mười tám tuổi."
        )
        self.assertEqual(mismatches, [])

    def test_accepts_idiomatic_doi_muoi_for_twenty(self):
        mismatches = find_number_mismatches(
            "哪怕是二十岁出头的女人。",
            "Dù là người phụ nữ đang ở độ tuổi đôi mươi.",
        )
        self.assertEqual(mismatches, [])

    def test_accepts_van_as_exact_ten_thousand(self):
        mismatches = find_number_mismatches(
            "你当少主，可比我威风一百倍，一万倍！",
            "Ngươi làm thiếu chủ uy phong hơn ta gấp trăm lần, gấp vạn lần!",
        )
        self.assertEqual(mismatches, [])

    def test_accepts_multiple_van_as_exact_number(self):
        mismatches = find_number_mismatches(
            "他已经等了二万年。",
            "Hắn đã chờ suốt hai vạn năm.",
        )
        self.assertEqual(mismatches, [])

    def test_does_not_treat_qian_bai_as_exact_1100(self):
        mismatches = find_number_mismatches(
            "武道界的规矩，千百年来就是如此。",
            "Quy tắc của giới võ đạo suốt hàng ngàn năm qua vẫn như vậy.",
        )
        self.assertEqual(mismatches, [])

    def test_still_checks_exact_1100(self):
        mismatches = find_number_mismatches(
            "这条规矩已经存在一千一百年。",
            "Quy tắc này đã tồn tại năm mươi năm.",
        )
        self.assertIn("一千一百=1100", mismatches)

    def test_does_not_treat_thirty_six_tiangang_as_days(self):
        mismatches = find_number_mismatches(
            "他参悟了三十六天罡。",
            "Hắn tham ngộ Tam Thập Lục Thiên Cang.",
        )
        self.assertEqual(mismatches, [])

    def test_still_checks_thirty_six_days(self):
        mismatches = find_number_mismatches(
            "他已经等了三十六天。",
            "Hắn đã chờ mười ngày.",
        )
        self.assertIn("三十六=36", mismatches)

    def test_accepts_decades_for_ten_year_unit_expression(self):
        mismatches = find_number_mismatches(
            "此道颇为复杂高深，没有十年为单位的钻研，是难有造诣的。",
            "Đạo này vô cùng phức tạp, nếu không nghiên cứu hàng chục năm thì khó có thành tựu.",
        )
        self.assertEqual(mismatches, [])

    def test_still_checks_exact_ten_year_duration(self):
        mismatches = find_number_mismatches(
            "他已经等了十年。",
            "Hắn đã chờ hai năm.",
        )
        self.assertIn("十=10", mismatches)

    def test_segment_ids_detect_omissions_and_are_removed(self):
        source = ("第一句。" * 40) + "\n" + ("第二句。" * 40)
        tagged, identifiers = _tag_source_segments(source)
        self.assertIn("[S0001]", tagged)
        self.assertIn("[S0002]", tagged)
        cleaned = _strip_valid_segment_ids(
            "[S0001] Câu thứ nhất.\n[S0002] Câu thứ hai.", identifiers
        )
        self.assertNotIn("[S0001]", cleaned)
        with self.assertRaises(ValueError):
            _strip_valid_segment_ids("[S0001] Chỉ có một câu.", identifiers)

    def test_source_lines_are_grouped_into_five_to_ten_ids_per_chunk(self):
        source = "\n".join("天地玄黄宇宙洪荒。" * 2 for _ in range(60))
        segments = _group_source_segments(source)
        self.assertGreaterEqual(len(segments), 5)
        self.assertLessEqual(len(segments), 10)
        self.assertTrue(all(len(segment) <= 250 for segment in segments))

    def test_only_failed_segment_is_retranslated_with_fast_model(self):
        source = "\n".join((character + "。") * 100 for character in "天地玄")

        class FakeClient:
            def __init__(self):
                self.models = []

            def translate(self, prompt, model=None):
                self.models.append(model)
                if len(self.models) == 1:
                    return (
                        "[S0001] Đoạn thứ nhất đã dịch xong.\n"
                        "[S0002] Đoạn thứ hai còn 天地 chưa dịch.\n"
                        "[S0003] Đoạn thứ ba đã dịch xong."
                    )
                return "[S0001] Đoạn thứ hai đã được dịch lại hoàn chỉnh."

        client = FakeClient()
        result = _translate_validated_chunk(client, source, {}, "", "Quy chuẩn")

        self.assertNotIn("天地", result)
        self.assertEqual(client.models, [None, None])

    def test_chunk_fingerprint_changes_with_glossary(self):
        first = _chunk_fingerprint("江凡。", {"江凡": "Phương Thần"}, "style")
        second = _chunk_fingerprint("江凡。", {"江凡": "Giang Phàm"}, "style")
        self.assertNotEqual(first, second)

    def test_falls_back_to_repair_model_for_chinese_residue(self):
        class FakeClient:
            def __init__(self):
                self.calls = []

            def translate(self, prompt, model=None):
                self.calls.append(model)
                if model is None:
                    return "[S0001] " + "Phương Thần gặp 王映凤. " * 10
                return "[S0001] " + "Phương Thần gặp Vương Ánh Phượng. " * 10

        client = FakeClient()
        result = _translate_validated_chunk(
            client, "江凡遇到王映凤。", {"江凡": "Phương Thần"},
            "江凡 = Phương Thần", "Quy chuẩn",
        )
        self.assertNotIn("王映凤", result)
        self.assertEqual(len(client.calls), 2)

    def test_name_variant_is_fixed_without_repair_model(self):
        class FakeClient:
            def __init__(self):
                self.calls = []

            def translate(self, prompt, model=None):
                self.calls.append(model)
                return "[S0001] " + "Hứa Du Nhiên bước vào đại sảnh. " * 10

        client = FakeClient()
        result = _translate_validated_chunk(
            client, "许悠然走进大厅。", {"许悠然": "Hứa U Nhiên"},
            "许悠然 = Hứa U Nhiên", "Quy chuẩn",
        )
        self.assertNotIn("Hứa Du Nhiên", result)
        self.assertIn("Hứa U Nhiên", result)
        self.assertEqual(client.calls, [None])

    def test_splits_source_after_recitation_block(self):
        class FakeClient:
            def __init__(self):
                self.calls = 0

            def translate(self, prompt, model=None):
                self.calls += 1
                if self.calls == 1:
                    raise GeminiRecitationError("recitation")
                return "[S0001] " + "Phương Thần tiếp tục tu luyện. " * 10

        client = FakeClient()
        result = _translate_validated_chunk(
            client, "甲。" * 250, {}, "", "Quy chuẩn",
        )
        self.assertGreaterEqual(client.calls, 3)
        self.assertIn("Phương Thần", result)

    def test_uses_repair_model_once_after_content_block(self):
        class FakeClient:
            def __init__(self):
                self.models = []
                self.prompts = []

            def translate(self, prompt, model=None):
                self.models.append(model)
                self.prompts.append(prompt)
                if model is None:
                    raise GeminiContentBlockedError("PROHIBITED_CONTENT")
                return "[S0001] " + "Phương Thần tiếp tục tu luyện. " * 10

        client = FakeClient()
        result = _translate_validated_chunk(
            client, "甲。" * 100, {}, "", "Quy chuẩn",
        )

        self.assertEqual(client.models, [None, SETTINGS.gemini_repair_model])
        self.assertIn("tiểu thuyết hư cấu", client.prompts[1])
        self.assertIn("Phương Thần", result)

    def test_content_block_fallback_drops_optional_reference_text(self):
        class FakeClient:
            def __init__(self):
                self.prompts = []

            def translate(self, prompt, model=None):
                self.prompts.append(prompt)
                if model is None:
                    raise GeminiContentBlockedError("PROHIBITED_CONTENT")
                return "[S0001] " + "Phương Thần tiếp tục tu luyện. " * 10

        client = FakeClient()
        _translate_validated_chunk(
            client, "甲。" * 100, {}, "", "Quy chuẩn",
            reference_text="THAM CHIẾU CÓ THỂ GÂY CHẶN",
        )

        self.assertIn("THAM CHIẾU CÓ THỂ GÂY CHẶN", client.prompts[0])
        self.assertNotIn("THAM CHIẾU CÓ THỂ GÂY CHẶN", client.prompts[1])


if __name__ == "__main__":
    unittest.main()
