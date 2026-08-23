"""test_ml_exit.py — the Phase 4 exit ladder.

Each rung gets a test that DISCRIMINATES it from the rung below: a case the
previous rung provably gets wrong. A ladder whose rungs all pass the same
fixtures is not a ladder.

    python server/test_ml_exit.py
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ml import exit_model as E     # noqa: E402

CORE = ["hog", "cannon", "skeletons", "musketeer", "log", "fireball", "ice-spirit"]


def event(deck=None, cluster_size=20, counts=None, recent=None, last_seen=None,
          streak=None, prior=None, outgoing=("ice-golem",), tag="#A"):
    deck = list(deck or (CORE + ["ice-golem"]))
    counts = counts or dict({c: cluster_size for c in CORE},
                            **{"ice-golem": 10})
    full = {str(w): {c: min(w, cluster_size) for c in deck} for w in (5, 10, 20)}
    return {
        "tag": tag, "domain": "duel", "ts": "20260810T120000.000Z",
        "prev_deck": deck, "outgoing": list(outgoing), "incoming": ["knight"],
        "n_changes": len(outgoing), "cluster_size": cluster_size,
        "cluster_card_counts": counts,
        "recent_counts": recent or full,
        "last_seen": last_seen or {c: 0 for c in deck},
        "streak": streak or {c: cluster_size for c in deck},
        "prior_edits": prior or [], "prior_edit_ctx": [],
    }


class PopulationStats(unittest.TestCase):
    def test_editability_counts_exits_over_appearances(self):
        stats = E.PopulationExitStats().fit([
            event(outgoing=("ice-golem",)),
            event(outgoing=("ice-golem",)),
            event(outgoing=("cannon",)),
        ])
        self.assertEqual(stats.exits["ice-golem"], 2)
        self.assertEqual(stats.seen["ice-golem"], 3)
        self.assertGreater(stats.editability("ice-golem"),
                           stats.editability("cannon"))

    def test_unseen_card_is_zero_not_a_crash(self):
        self.assertEqual(E.PopulationExitStats().editability("nothing"), 0.0)

    def test_shrinkage_stops_one_exit_dominating(self):
        """Seen once, dropped once, must not read as certainty."""
        stats = E.PopulationExitStats().fit([event(outgoing=("ice-golem",))])
        self.assertLess(stats.editability("ice-golem"), 0.3)


class LadderShape(unittest.TestCase):
    def setUp(self):
        self.stats = E.PopulationExitStats().fit([event()])

    def test_every_rung_ranks_the_whole_deck_once(self):
        ev = event(prior=[[["ice-golem"], ["knight"]]])
        for cls in E.LADDER:
            ranked = cls(self.stats).rank(ev)
            self.assertEqual(set(ranked), set(ev["prev_deck"]), cls.name)
            self.assertEqual(len(ranked), len(set(ranked)), cls.name)

    def test_rankings_are_deterministic(self):
        ev = event(prior=[[["ice-golem"], ["knight"]]])
        for cls in E.LADDER:
            self.assertEqual(cls(self.stats).rank(ev), cls(self.stats).rank(ev))

    def test_all_equal_cards_still_rank_deterministically(self):
        deck = CORE + ["ice-golem"]
        ev = event(counts={c: 20 for c in deck})
        self.assertEqual(E.E0LeastStable(self.stats).rank(ev), sorted(deck))


class E0(unittest.TestCase):
    def test_least_fielded_card_ranks_first(self):
        ranked = E.E0LeastStable().rank(event())
        self.assertEqual(ranked[0], "ice-golem")


class E1(unittest.TestCase):
    def test_a_broken_streak_is_less_stable_than_an_unbroken_one(self):
        """Same usage count; only the current run differs."""
        deck = CORE + ["ice-golem"]
        counts = dict({c: 15 for c in CORE}, **{"ice-golem": 15})
        streak = dict({c: 15 for c in CORE}, **{"ice-golem": 0})
        ev = event(counts=counts, streak=streak)
        self.assertEqual(E.E1PlayerStability().rank(ev)[0], "ice-golem")


class E2(unittest.TestCase):
    """The discriminating case: high aggregate usage, recently absent."""

    def _fixture(self):
        deck = CORE + ["ice-golem"]
        # ice-golem: 14/20 lifetime (more than cannon's 11) but gone for 6.
        counts = dict({c: 20 for c in CORE}, **{"ice-golem": 14})
        counts["cannon"] = 11
        recent = {
            "5": dict({c: 5 for c in deck}, **{"ice-golem": 0, "cannon": 5}),
            "10": dict({c: 10 for c in deck}, **{"ice-golem": 1, "cannon": 10}),
            "20": dict({c: 20 for c in deck}, **{"ice-golem": 14, "cannon": 11}),
        }
        last_seen = dict({c: 0 for c in deck}, **{"ice-golem": 6})
        return event(counts=counts, recent=recent, last_seen=last_seen,
                     streak=dict({c: 20 for c in deck}, **{"ice-golem": 0}))

    def test_e0_is_fooled_by_the_aggregate(self):
        """E0 sees only lifetime counts, so it picks the wrong card."""
        self.assertEqual(E.E0LeastStable().rank(self._fixture())[0], "cannon")

    def test_e2_sees_the_absence(self):
        self.assertEqual(E.E2RecencyStability().rank(self._fixture())[0],
                         "ice-golem")


class E3(unittest.TestCase):
    """Editability is NOT one minus stability, and this proves it."""

    def _fixture(self):
        deck = CORE + ["ice-golem"]
        # musketeer is ALWAYS fielded but is the slot this player retunes.
        # ice-golem is fielded least but has never been the card dropped.
        counts = dict({c: 20 for c in CORE}, **{"ice-golem": 12})
        prior = [[["musketeer"], ["wizard"]] for _ in range(8)]
        return event(counts=counts, prior=prior)

    def test_stability_rungs_pick_the_rarest_card(self):
        ev = self._fixture()
        self.assertEqual(E.E0LeastStable().rank(ev)[0], "ice-golem")
        self.assertEqual(E.E1PlayerStability().rank(ev)[0], "ice-golem")

    def test_editability_picks_the_slot_actually_retuned(self):
        stats = E.PopulationExitStats().fit([event()])
        self.assertEqual(E.E3Editability(stats).rank(self._fixture())[0],
                         "musketeer")

    def test_no_edit_history_falls_back_to_instability(self):
        """With nothing personal, E3 must not return an arbitrary order."""
        stats = E.PopulationExitStats().fit([event()])
        ev = event(prior=[])
        self.assertEqual(E.E3Editability(stats).rank(ev)[0], "ice-golem")

    def test_one_prior_edit_does_not_beat_a_strong_stability_signal(self):
        deck = CORE + ["ice-golem"]
        counts = dict({c: 20 for c in CORE}, **{"ice-golem": 1})
        stats = E.PopulationExitStats().fit([event()])
        ev = event(counts=counts, prior=[[["musketeer"], ["wizard"]]])
        self.assertEqual(E.E3Editability(stats).rank(ev)[0], "ice-golem",
                         "a single observed edit must not outrank 1/20 usage")


class E4(unittest.TestCase):
    def test_combines_both_signals(self):
        stats = E.PopulationExitStats().fit([event()])
        deck = CORE + ["ice-golem"]
        counts = dict({c: 20 for c in CORE}, **{"ice-golem": 12})
        recent = {"5": dict({c: 5 for c in deck}, **{"ice-golem": 0}),
                  "10": dict({c: 10 for c in deck}, **{"ice-golem": 2}),
                  "20": dict({c: 20 for c in deck}, **{"ice-golem": 12})}
        ev = event(counts=counts, recent=recent,
                   last_seen=dict({c: 0 for c in deck}, **{"ice-golem": 5}),
                   prior=[[["ice-golem"], ["knight"]] for _ in range(4)])
        self.assertEqual(E.E4Combined(stats).rank(ev)[0], "ice-golem")

    def test_missing_recency_fields_do_not_crash(self):
        """An older cache without the Phase 4 fields must degrade, not raise."""
        ev = event()
        del ev["recent_counts"], ev["last_seen"], ev["streak"]
        stats = E.PopulationExitStats().fit([event()])
        for cls in (E.E1PlayerStability, E.E2RecencyStability, E.E4Combined):
            self.assertEqual(len(cls(stats).rank(ev)), 8, cls.name)


if __name__ == "__main__":
    unittest.main(verbosity=1)
