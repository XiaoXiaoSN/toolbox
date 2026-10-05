"""Exercise the exact SQL embedded in the Worker, without mocking queries."""
from pathlib import Path
import sqlite3
import unittest

ROOT = Path(__file__).resolve().parents[1]


class SqlTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.executescript((ROOT / "migrations/0001_initial.sql").read_text())

    def tearDown(self):
        self.db.close()

    def query(self, name, *args):
        return self.db.execute((ROOT / f"sql/{name}.sql").read_text(), args).fetchall()

    def test_clipboard_missing_empty_unicode_and_overwrite(self):
        self.assertEqual(self.query("get_clipboard"), [])
        for text in ["", "台灣\n'quote'\x00", "latest"]:
            self.query("put_clipboard", text)
            self.assertEqual(self.query("get_clipboard"), [(text,)])
        self.assertEqual(self.db.execute("SELECT count(*) FROM clipboard").fetchone(), (1,))

    def test_utf8_byte_limit(self):
        self.query("put_clipboard", "台" * 3333)
        with self.assertRaises(sqlite3.IntegrityError):
            self.query("put_clipboard", "台" * 3334)

    def test_generated_collision_does_not_overwrite(self):
        self.assertEqual(self.query("insert_link", "same", "https://first/"), [("same",)])
        self.assertEqual(self.query("insert_link", "same", "https://second/"), [])
        self.assertEqual(self.query("get_link", "same"), [("https://first/",)])

    def test_custom_code_upsert_and_delete(self):
        self.assertEqual(self.query("upsert_link", "custom", "https://first/"), [("https://first/", "custom")])
        self.assertEqual(self.query("upsert_link", "custom", "https://second/"), [("https://second/", "custom")])
        self.assertEqual(self.query("get_link", "custom"), [("https://second/",)])
        self.assertEqual(self.query("delete_link", "custom"), [("custom",)])
        self.assertEqual(self.query("delete_link", "custom"), [])
        self.assertEqual(self.query("get_link", "custom"), [])

    def test_ordered_cursor_and_case_sensitive_keys(self):
        for code in ["z", "a", "A", "b"]:
            self.query("insert_link", code, f"https://example.com/{code}")
        first = self.query("list_links", "", 2)
        self.assertEqual([row[1] for row in first], ["A", "a"])
        second = self.query("list_links", first[-1][1], 2)
        self.assertEqual([row[1] for row in second], ["b", "z"])

    def test_reserved_and_invalid_codes_rejected(self):
        for code in ["PB", "pb", "api", "marquee", "surl", "", "a/b", "a'", "a" * 65]:
            with self.subTest(code=code), self.assertRaises(sqlite3.IntegrityError):
                self.query("insert_link", code, "https://example.com/")

    def test_lookups_and_pagination_use_primary_key(self):
        for name, args in [("get_link", ("a",)), ("list_links", ("a", 100))]:
            sql = (ROOT / f"sql/{name}.sql").read_text()
            plan = str(self.db.execute("EXPLAIN QUERY PLAN " + sql, args).fetchall())
            self.assertIn("SEARCH short_links USING INDEX sqlite_autoindex_short_links_1", plan)


if __name__ == "__main__":
    unittest.main()
