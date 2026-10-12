import json
import tempfile
import unittest
from pathlib import Path

from app.translator.glossary import (
    _parse_discovered_entries, discover_glossary_entries, load_glossary,
    relevant_glossary, save_glossary,
)


class GlossaryDiscoveryTests(unittest.TestCase):
    def test_filters_entries_not_in_source_and_never_overwrites_existing(self):
        source = "朱见深加入青云宗，并见到了江凡。"
        response = json.dumps({
            "entries": [
                {"source": "朱见深", "target": "Chu Kiến Thâm", "kind": "person"},
                {"source": "青云宗", "target": "Thanh Vân Tông", "kind": "sect"},
                {"source": "江凡", "target": "Giang Phàm", "kind": "person"},
                {"source": "不存在", "target": "Không Tồn Tại", "kind": "person"},
            ]
        }, ensure_ascii=False)

        entries = _parse_discovered_entries(
            response, source, {"江凡": "Phương Thần"}
        )

        self.assertEqual(entries["朱见深"], "Chu Kiến Thâm")
        self.assertNotIn("青云宗", entries)
        self.assertNotIn("江凡", entries)
        self.assertNotIn("不存在", entries)

    def test_accepts_json_code_fence(self):
        response = '```json\n{"entries":[{"source":"朱见深","target":"Chu Kiến Thâm","kind":"person"}]}\n```'
        entries = _parse_discovered_entries(response, "朱见深来了。", {})
        self.assertEqual(entries, {"朱见深": "Chu Kiến Thâm"})

    def test_discovery_prompt_contains_existing_glossary(self):
        class FakeClient:
            def __init__(self):
                self.prompt = ""

            def translate(self, prompt, model=None):
                self.prompt = prompt
                return '{"entries":[{"source":"朱见深","target":"Chu Kiến Thâm","kind":"person"}]}'

        client = FakeClient()
        entries = discover_glossary_entries(
            client, "朱见深见到了江凡。", {"江凡": "Phương Thần"}
        )
        self.assertIn("江凡 = Phương Thần", client.prompt)
        self.assertEqual(entries, {"朱见深": "Chu Kiến Thâm"})

    def test_rejects_non_person_and_missing_kind(self):
        source = "朱见深进入青云宗。"
        response = json.dumps({"entries": [
            {"source": "朱见深", "target": "Chu Kiến Thâm"},
            {"source": "青云宗", "target": "Thanh Vân Tông", "kind": "sect"},
        ]}, ensure_ascii=False)
        self.assertEqual(_parse_discovered_entries(response, source, {}), {})

    def test_saves_glossary_atomically(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "glossary.json"
            save_glossary(path, {"江凡": "Phương Thần"})
            self.assertEqual(load_glossary(path), {"江凡": "Phương Thần"})

    def test_filters_glossary_to_current_chunk(self):
        glossary = {"江凡": "Phương Thần", "朱见深": "Chu Kiến Thâm"}
        self.assertEqual(
            relevant_glossary(glossary, "江凡开始修炼。"),
            {"江凡": "Phương Thần"},
        )


if __name__ == "__main__":
    unittest.main()
