import json
import tempfile
import unittest
from pathlib import Path

from app.translator.glossary_builder import (
    load_candidate_store, merge_candidates, parse_candidate_response,
)


class GlossaryBuilderTests(unittest.TestCase):
    def test_parses_only_entities_present_in_raw(self):
        sources = {35: "朱见深拿出了还颜丹。"}
        response = json.dumps({"entries": [
            {"source": "朱见深", "target": "Chu Kiến Thâm", "kind": "person"},
            {"source": "不存在", "target": "Không Tồn Tại", "kind": "person"},
        ]}, ensure_ascii=False)
        result = parse_candidate_response(response, sources, {})
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["target"], "Chu Kiến Thâm")

    def test_rejects_source_with_trailing_chinese_particle(self):
        sources = {2: "碧柳城的人已经到了。"}
        response = json.dumps({"entries": [
            {"source": "碧柳城的", "target": "Bích Liễu Thành", "kind": "place"},
        ]}, ensure_ascii=False)
        self.assertEqual(parse_candidate_response(response, sources, {}), [])

    def test_merges_alternative_translations_as_conflicts(self):
        store = {"entries": {}, "processed_chapters": []}
        merge_candidates(store, [{
            "source": "朱见深", "target": "Chu Kiến Thâm",
            "kind": "person", "chapters": [35],
        }])
        merge_candidates(store, [{
            "source": "朱见深", "target": "Chu Kiến Sâu",
            "kind": "person", "chapters": [36],
        }])
        item = store["entries"]["朱见深"]
        self.assertEqual(item["chapters"], [35, 36])
        self.assertEqual(item["alternatives"], ["Chu Kiến Sâu"])
        self.assertEqual(item["status"], "pending")

    def test_loads_empty_store_when_file_is_missing(self):
        with tempfile.TemporaryDirectory() as directory:
            value = load_candidate_store(Path(directory) / "missing.json")
        self.assertEqual(value, {"entries": {}, "processed_chapters": []})


if __name__ == "__main__":
    unittest.main()
