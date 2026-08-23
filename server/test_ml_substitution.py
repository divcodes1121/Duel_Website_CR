"""test_ml_substitution.py — the M3 ablation ladder.

Synthetic only: no database, no network.

    python server/test_ml_substitution.py
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ml import substitution as S     # noqa: E402

CORE = ["hog", "cannon", "skeletons", "musketeer", "log", "fireball", "ice-spirit"]


def event(outgoing=("ice-golem",), incoming=("knight",), prior=None,
          ctx=None, counts=None, domain="duel", tag="#A",
          opp_wc="golem", result="loss"):
    """One edit, with whatever prefix evidence a rung needs."""
    return {
        "tag": tag, "domain": domain, "ts": "20260810T120000.000Z",
        "prev_deck": CORE + ["ice-golem"],
        "outgoing": list(outgoing), "incoming": list(incoming),
        "n_changes": len(incoming), "cluster_size": 12,
        "cluster_card_counts": counts or dict(
            {c: 12 for c in CORE},
            **{"ice-golem": 8, "knight": 4, "valkyrie": 4, "tesla": 4}),
        "prior_edits": prior or [],
        "prior_edit_ctx": ctx or [],
        "opp_wc": opp_wc, "opp_hash": "", "result": result,
    }


class CandidatePool(unittest.TestCase):
    def test_pool_excludes_the_current_deck(self):
        ev = event()
        pool = S.Ranker.pool(ev)
        for card in ev["prev_deck"]:
            self.assertNotIn(card, pool, "a fielded card cannot enter")

    def test_pool_is_the_players_vocabulary(self):
        self.assertEqual(S.Ranker.pool(event()), ["knight", "tesla", "valkyrie"])

    def test_pool_is_deterministic(self):
        self.assertEqual(S.Ranker.pool(event()), S.Ranker.pool(event()))


class GlobalStats(unittest.TestCase):
    def test_counts_incoming_and_transitions(self):
        stats = S.GlobalStats().fit([
            event(outgoing=("ice-golem",), incoming=("knight",)),
            event(outgoing=("ice-golem",), incoming=("knight",)),
            event(outgoing=("ice-golem",), incoming=("valkyrie",)),
        ])
        self.assertEqual(stats.incoming["knight"], 2)
        self.assertEqual(stats.transition["ice-golem"]["knight"], 2)
        self.assertEqual(stats.transition["ice-golem"]["valkyrie"], 1)

    def test_distribution_sums_to_one(self):
        stats = S.GlobalStats().fit([event(), event(incoming=("valkyrie",))])
        self.assertAlmostEqual(sum(stats.incoming_dist.values()), 1.0, places=6)

    def test_empty_stats_are_safe(self):
        self.assertEqual(S.GlobalStats().incoming_dist, {})


class LadderBehaviour(unittest.TestCase):
    def setUp(self):
        self.stats = S.GlobalStats().fit(
            [event(incoming=("valkyrie",)) for _ in range(20)])

    def test_s0_follows_the_population_not_the_player(self):
        """Global saw only valkyrie, so valkyrie leads regardless of player."""
        ranked = S.S0Global(self.stats).rank(event())
        self.assertEqual(ranked[0], "valkyrie")

    def test_s1_follows_player_frequency(self):
        counts = dict({c: 12 for c in CORE},
                      **{"ice-golem": 8, "knight": 9, "valkyrie": 2, "tesla": 1})
        ranked = S.S1Player(self.stats).rank(event(counts=counts))
        self.assertEqual(ranked[0], "knight",
                         "the player's most-fielded spare card should lead")

    def test_s2_uses_the_outgoing_card(self):
        """THE KEY EXPERIMENT, in miniature.

        Player frequency favours tesla; their transitions from ice-golem all
        went to knight. S2 must prefer knight, S1 must prefer tesla.
        """
        counts = dict({c: 12 for c in CORE},
                      **{"ice-golem": 8, "knight": 2, "valkyrie": 1, "tesla": 9})
        prior = [[["ice-golem"], ["knight"]] for _ in range(6)]
        ev = event(counts=counts, prior=prior)
        self.assertEqual(S.S1Player(self.stats).rank(ev)[0], "tesla")
        self.assertEqual(S.S2Transition(self.stats).rank(ev)[0], "knight")

    def test_s2_falls_back_when_the_player_has_no_transitions(self):
        """One observation must not dominate; with none, S2 must not crash."""
        ev = event(prior=[])
        self.assertEqual(len(S.S2Transition(self.stats).rank(ev)), 3)

    def test_thin_support_is_discounted(self):
        """A single prior edit must not outrank a strong frequency signal."""
        counts = dict({c: 12 for c in CORE},
                      **{"ice-golem": 8, "knight": 1, "valkyrie": 1, "tesla": 40})
        one = event(counts=counts, prior=[[["ice-golem"], ["knight"]]])
        many = event(counts=counts,
                     prior=[[["ice-golem"], ["knight"]] for _ in range(12)])
        self.assertEqual(S.S2Transition(self.stats).rank(one)[0], "tesla")
        self.assertEqual(S.S2Transition(self.stats).rank(many)[0], "knight")

    def test_every_rung_returns_the_whole_pool(self):
        ev = event(prior=[[["ice-golem"], ["knight"]]] * 4,
                   ctx=[{"out": ["ice-golem"], "in": ["valkyrie"],
                         "opp_wc": "golem", "opp_hash": "", "result": "loss"}] * 4)
        pool = set(S.Ranker.pool(ev))
        for cls in S.LADDER:
            ranked = cls(self.stats).rank(ev)
            self.assertEqual(set(ranked), pool, cls.name)
            self.assertEqual(len(ranked), len(set(ranked)), cls.name)


class ContextRungs(unittest.TestCase):
    def setUp(self):
        self.stats = S.GlobalStats().fit([event() for _ in range(5)])

    def test_opponent_archetype_changes_the_answer(self):
        """Against golem this player has always brought valkyrie."""
        prior = [[["ice-golem"], ["knight"]] for _ in range(8)]
        ctx = [{"out": ["ice-golem"], "in": ["valkyrie"],
                "opp_wc": "golem", "opp_hash": "", "result": "loss"}
               for _ in range(8)]
        ev = event(prior=prior, ctx=ctx, opp_wc="golem")
        self.assertEqual(S.S2Transition(self.stats).rank(ev)[0], "knight")
        self.assertEqual(S.S3OpponentArchetype(self.stats).rank(ev)[0], "valkyrie")

    def test_context_with_no_match_falls_back_to_s2(self):
        prior = [[["ice-golem"], ["knight"]] for _ in range(8)]
        ctx = [{"out": ["ice-golem"], "in": ["valkyrie"],
                "opp_wc": "hog", "opp_hash": "", "result": "win"}] * 8
        ev = event(prior=prior, ctx=ctx, opp_wc="golem")
        self.assertEqual(S.S3OpponentArchetype(self.stats).rank(ev),
                         S.S2Transition(self.stats).rank(ev))

    def test_empty_context_value_is_ignored(self):
        """A blank archetype must not match every blank prior edit."""
        ctx = [{"out": ["ice-golem"], "in": ["valkyrie"],
                "opp_wc": "", "opp_hash": "", "result": ""}] * 8
        ev = event(prior=[[["ice-golem"], ["knight"]]] * 8, ctx=ctx, opp_wc="")
        self.assertEqual(S.S3OpponentArchetype(self.stats).rank(ev),
                         S.S2Transition(self.stats).rank(ev))


class ExitPrediction(unittest.TestCase):
    def test_least_stable_card_ranks_first(self):
        ranked = S.ExitRanker.rank(event())
        self.assertEqual(ranked[0], "ice-golem")

    def test_only_ranks_cards_in_the_deck(self):
        ev = event()
        self.assertEqual(set(S.ExitRanker.rank(ev)), set(ev["prev_deck"]))

    def test_a_fully_stable_deck_still_ranks_deterministically(self):
        counts = {c: 12 for c in CORE + ["ice-golem"]}
        ev = event(counts=counts)
        self.assertEqual(S.ExitRanker.rank(ev), sorted(ev["prev_deck"]))


class Support(unittest.TestCase):
    def test_confidence_is_monotone_and_bounded(self):
        vals = [S._confidence(n) for n in (0, 1, 3, 10, 100)]
        self.assertEqual(vals[0], 0.0)
        self.assertTrue(all(a < b for a, b in zip(vals, vals[1:])))
        self.assertLess(vals[-1], 1.0)

    def test_one_observation_is_never_full_confidence(self):
        self.assertLess(S._confidence(1), 0.35)


if __name__ == "__main__":
    unittest.main(verbosity=1)
