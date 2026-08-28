"""Checks over the player-name search. No network; a temp SQLite for the DB.

The module is four decisions — a length floor, a LIKE with escaped wildcards, a
starts-with-first ordering, and never raising — and each is checked here against
a real table rather than a stub, because the ordering and the escaping are SQL
and a mock would only be testing my idea of what SQLite does.
"""

from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import clash_data as cd  # noqa: E402
import player_search as ps  # noqa: E402

NAMES = [
    ("#9GJ0Q0LGG", "INA.BenZerRidel"),
    ("#QUYYYPYRG", "Ninja Shoyo"),
    ("#VRY98QYVC", "BLINK"),
    ("#2G2V9PQ8G", "ninjaNINJA"),
    ("#YPPPPJCU8", "african cycle"),
    ("#CCU9QPUGG", "Mr Ninja"),
    ("#PGV8JQ922", "50%_off"),      # both LIKE wildcards, in one name
    ("#RL88PYRG", ""),              # stored blank; must never be offered
]


class Base(unittest.TestCase):
    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        con = sqlite3.connect(self.path)
        con.execute("CREATE TABLE player_names (tag TEXT PRIMARY KEY, name TEXT)")
        con.executemany("INSERT INTO player_names VALUES (?, ?)", NAMES)
        con.commit()
        con.close()
        self._resolve = cd.resolve_db_path
        cd.resolve_db_path = lambda: self.path

    def tearDown(self):
        cd.resolve_db_path = self._resolve
        try:
            os.remove(self.path)
        except OSError:
            pass

    def names(self, q, **kw):
        return [r["name"] for r in ps.search(q, **kw)]


class Matching(Base):

    def test_it_finds_a_substring_anywhere_in_the_name(self):
        self.assertIn("Mr Ninja", self.names("ninja"))

    def test_it_is_case_insensitive(self):
        self.assertEqual(set(self.names("NINJA")), set(self.names("ninja")))

    def test_a_starts_with_match_comes_first(self):
        """'Ninja Shoyo' and 'ninjaNINJA' start with it; 'Mr Ninja' does not."""
        got = self.names("ninja")
        self.assertEqual(len(got), 3)
        self.assertEqual(got[-1], "Mr Ninja")

    def test_ties_are_alphabetical_and_not_by_volume(self):
        """The loudest account is not the one you meant, so there is no
        `battles` tiebreak to be wrong about."""
        got = self.names("ninja")
        self.assertEqual(got[:2], ["Ninja Shoyo", "ninjaNINJA"])

    def test_a_blank_stored_name_is_never_offered(self):
        for r in ps.search("a"):
            self.assertTrue(r["name"])
        self.assertNotIn("", self.names("i"))

    def test_every_row_carries_a_normalised_tag(self):
        for r in ps.search("ninja"):
            self.assertTrue(r["tag"].startswith("#"))
            self.assertEqual(r["tag"], r["tag"].upper())


class Wildcards(Base):
    """`%` and `_` are LIKE syntax and a player name may contain either."""

    def test_a_percent_is_a_literal(self):
        self.assertEqual(self.names("50%"), ["50%_off"])

    def test_an_underscore_is_a_literal(self):
        """Unescaped, `_` matches any single character — `%_o` would also pull
        in nothing here, but `5_%` would match names it should not."""
        self.assertEqual(self.names("%_off"), ["50%_off"])

    def test_a_bare_percent_does_not_match_everything(self):
        self.assertEqual(self.names("%%"), [])


class Limits(Base):

    def test_a_query_under_the_floor_returns_nothing(self):
        """One character matches most of the table; that is a scan, not a
        search."""
        self.assertEqual(ps.search("n"), [])
        self.assertEqual(ps.search(""), [])
        self.assertEqual(ps.search("  "), [])

    def test_the_floor_is_two(self):
        self.assertEqual(ps.MIN_QUERY, 2)
        self.assertNotEqual(ps.search("ni"), [])

    def test_the_cap_is_honoured(self):
        self.assertLessEqual(len(ps.search("ninja", limit=2)), 2)

    def test_the_cap_cannot_be_raised_past_max_results(self):
        self.assertLessEqual(len(ps.search("i", limit=9999)), ps.MAX_RESULTS)


class NeverRaises(Base):

    def test_no_database_is_an_empty_list(self):
        cd.resolve_db_path = lambda: None
        self.assertEqual(ps.search("ninja"), [])

    def test_a_database_without_the_table_is_an_empty_list(self):
        """An older bot build predates `player_names`."""
        con = sqlite3.connect(self.path)
        con.execute("DROP TABLE player_names")
        con.commit()
        con.close()
        self.assertEqual(ps.search("ninja"), [])

    def test_an_unopenable_path_is_an_empty_list(self):
        cd.resolve_db_path = lambda: os.path.join(self.path, "nope", "x.db")
        self.assertEqual(ps.search("ninja"), [])


class Boundaries(unittest.TestCase):

    def test_it_opens_nothing_read_write(self):
        src = open(
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "player_search.py"),
            encoding="utf-8",
        ).read()
        self.assertNotIn("sqlite3.connect", src)
        self.assertIn("cd.connect", src)

    def test_it_returns_only_a_tag_and_a_name(self):
        """A search endpoint that ships stats is a second, worse copy of the
        player endpoint."""
        src = open(
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "player_search.py"),
            encoding="utf-8",
        ).read()
        self.assertIn('"tag": tag, "name"', src)
        self.assertNotIn("battles", src.split('"""', 2)[-1])


if __name__ == "__main__":
    unittest.main(verbosity=2)
