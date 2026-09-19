"""test_ml_shadow_measurement.py - the R3 measurement contract (shadow schema 2).

The shadow log could not be scored scientifically: it did not record the stamp
the model used, when the rows behind a prediction were read, or whether the
player was tracked, and its outcome join collided on (player, second). These
tests pin the fix. None of them may change a prediction: the first three are
the proof that the instrumentation is measurement only.

Every test writes to a temp log and a temp SQLite file. Nothing here can reach
the production log or the bot's database.

    python server/test_ml_shadow_measurement.py
"""
import datetime
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import clash_data as cd                       # noqa: E402
from ml import features as F                  # noqa: E402
from ml.dataset import DeckPlay               # noqa: E402
from ml.production import predictor as P      # noqa: E402
from ml.production import shadow, source      # noqa: E402

TAG = "#TESTQ2Y8"          # a made-up tag in the real alphabet; never a player's
#: test_ml_production's shell. With the last play an hour old it lands in the
#: HIGH band with two alternatives, so "the prediction is unchanged" is tested
#: on a result that has alternatives to lose.
CORE = ["hog", "cannon", "skeletons", "musketeer", "log", "fireball", "ice-spirit"]
I9 = F.FEATURE_NAMES.index("log_hours_since_change")
I10 = F.FEATURE_NAMES.index("log_hours_since_last_play")


def bt(dt):
    return dt.strftime("%Y%m%dT%H%M%S") + ".000Z"


NOW = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)


def deck(extra):
    return sorted(CORE + [extra])


def fixture_rows(n=12, end=None):
    """A settled shell: knight, then an ice-golem swap, inside the 60-day window."""
    end = end or NOW - datetime.timedelta(hours=1)
    rows = []
    for i in range(n):
        extra = "knight" if i < n - 3 or i == n - 2 else "ice-golem"
        t = end - datetime.timedelta(days=n - 1 - i)
        rows.append((bt(t), "Ladder", json.dumps(deck(extra)), "win", ""))
    return rows


class TempWorld(unittest.TestCase):
    """A temp battles.db + temp shadow log, and a cold engine cache."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.db = os.path.join(self.dir, "battles.db")
        con = sqlite3.connect(self.db)
        con.execute("CREATE TABLE battles (player_tag TEXT, battle_time TEXT, "
                    "game_mode TEXT, player_card_keys TEXT, result TEXT, "
                    "opponent_win_condition TEXT)")
        con.execute("CREATE TABLE tracked_players (tag TEXT)")
        con.commit()
        con.close()
        self.add_rows(fixture_rows())
        self.patches = [mock.patch.object(cd, "resolve_db_path", lambda: self.db),
                        mock.patch.object(shadow, "LOG_PATH",
                                          os.path.join(self.dir, "shadow-log.jsonl"))]
        for p in self.patches:
            p.start()
        source.clear_cache()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        source.clear_cache()

    def add_rows(self, rows, tag=TAG):
        con = sqlite3.connect(self.db)
        con.executemany("INSERT INTO battles VALUES (?,?,?,?,?,?)",
                        [(tag,) + tuple(r) for r in rows])
        con.commit()
        con.close()

    def track(self, tag=TAG):
        con = sqlite3.connect(self.db)
        con.execute("INSERT INTO tracked_players VALUES (?)", (tag,))
        con.commit()
        con.close()

    def log(self):
        return shadow.load(shadow.LOG_PATH)


# --------------------------------------------------------------------------- 1-3
class PredictionUnchanged(TempWorld):
    """1. The prediction is byte-identical with and without the shadow record."""

    def test_prediction_unchanged(self):
        plain = P.predict_for_tag(TAG, "competitive")
        source.clear_cache()
        shadowed = P.predict_for_tag(TAG, "competitive", record_shadow=True)
        direct = P.predict(TAG, "competitive", source.load_plays(TAG, "competitive"))
        self.assertEqual(plain.as_dict(), shadowed.as_dict())
        self.assertEqual(plain.change_probability, shadowed.change_probability)
        self.assertEqual(plain.as_dict(), direct.as_dict())
        self.assertEqual(plain.alternatives, shadowed.alternatives)
        self.assertGreaterEqual(len(plain.alternatives), 2)      # load-bearing fixture
        self.assertEqual(len(self.log()), 1)

    def test_x9_unchanged(self):
        """2. x9 is still computed and still served as 0 on the shadow path."""
        served, extracted = [], []
        real_served, real_extract = P._served_vector, P.F.extract

        def spy_served(ex):
            v = real_served(ex)
            served.append(v)
            return v

        def spy_extract(ex):
            v = real_extract(ex)
            extracted.append(list(v))
            return v
        with mock.patch.object(P, "_served_vector", spy_served), \
                mock.patch.object(P.F, "extract", spy_extract):
            P.predict_for_tag(TAG, "competitive", record_shadow=True)
        self.assertEqual(P.SERVED_AS_ZERO, (I9,))
        self.assertEqual(served[0][I9], 0.0)
        self.assertGreater(extracted[0][I9], 0.0)
        self.assertEqual([v for i, v in enumerate(served[0]) if i != I9],
                         [v for i, v in enumerate(extracted[0]) if i != I9])

    def test_x10_live(self):
        """3. x10 is live, and computed from exactly the stamp that is recorded."""
        seen = []
        real = P.F.extract

        def spy(ex):
            seen.append(ex.timestamp)
            return real(ex)
        with mock.patch.object(P.F, "extract", spy):
            P.predict_for_tag(TAG, "competitive", record_shadow=True)
        e = self.log()[-1]
        self.assertEqual(e["requestStamp"], seen[0])
        plays = source.load_plays(TAG, "competitive")
        _, shell = P.adapter.build_context(TAG, "competitive", plays, None)
        from ml.dataset import PredictionExample
        cp = tuple(DeckPlay(battle_time=p.battle_time, mode=p.mode, cards=p.cards,
                            result=p.result) for p in shell)
        x = F.extract(PredictionExample(player_tag=TAG, timestamp=e["requestStamp"],
                                        domain="competitive", history=cp,
                                        truth=DeckPlay(battle_time="9999", mode="", cards=()),
                                        cluster_history=cp))
        self.assertGreater(x[I10], 0.0)


# --------------------------------------------------------------------------- 4-5
class Clocks(TempWorld):

    def test_request_timestamp(self):
        """4. requestedAt is taken before the read, requestStamp is what the
        model used, and they are recorded separately."""
        stamps = iter(["20990101T000000.000Z", "20990101T000007.000Z"])
        with mock.patch.object(P, "_request_stamp", lambda: next(stamps)), \
                mock.patch.object(source, "_wall_stamp", lambda: "20990101T000003.000Z"):
            P.predict_for_tag(TAG, "competitive", record_shadow=True)
        e = self.log()[-1]
        self.assertEqual(e["schema"], 2)
        self.assertEqual(e["requestedAt"], "20990101T000000.000Z")
        self.assertEqual(e["requestStamp"], "20990101T000007.000Z")
        self.assertEqual(e["visibleAsOf"], "20990101T000003.000Z")
        self.assertTrue(shadow.measurement_order_ok(e))
        # a caller-supplied cutoff IS the stamp
        P.predict(TAG, "competitive", source.load_plays(TAG, "competitive"),
                  cutoff_ts=bt(NOW))
        self.assertEqual(P.last_stamp(), bt(NOW))

    def test_visibility_cutoff(self):
        """5. The cutoff is when the rows were READ. A cache hit and a probe
        reuse the original read's cutoff; a row that lands later is invisible
        until a real re-read, and then the cutoff moves."""
        first_latest = fixture_rows()[-1][0]
        with mock.patch.object(source, "_wall_stamp", lambda: "20990101T000001.000Z"):
            source.load_plays(TAG, "competitive")
        m1 = source.last_read()
        self.assertEqual((m1["readPath"], m1["visibleAsOf"], m1["latestVisibleBattle"],
                          m1["visibleRows"]),
                         ("miss", "20990101T000001.000Z", first_latest, 12))

        # probe with nothing new: lease extended, cutoff unchanged
        with mock.patch.object(source, "SOFT_TTL_S", 0.0), \
                mock.patch.object(source, "_wall_stamp", lambda: "20990101T000009.000Z"):
            source.load_plays(TAG, "competitive")
        m2 = source.last_read()
        self.assertEqual((m2["readPath"], m2["visibleAsOf"]), ("probe", "20990101T000001.000Z"))

        newer = bt(NOW - datetime.timedelta(minutes=10))
        self.add_rows([(newer, "Ladder", json.dumps(deck("knight")), "victory", "")])
        with mock.patch.object(source, "_wall_stamp", lambda: "20990101T000020.000Z"):
            plays = source.load_plays(TAG, "competitive")     # inside the TTL: hit
        m3 = source.last_read()
        self.assertEqual((m3["readPath"], m3["visibleAsOf"], m3["latestVisibleBattle"]),
                         ("hit", "20990101T000001.000Z", first_latest))
        self.assertNotIn(newer, [p.battle_time for p in plays])

        with mock.patch.object(source, "SOFT_TTL_S", 0.0), \
                mock.patch.object(source, "_wall_stamp", lambda: "20990101T000030.000Z"):
            plays = source.load_plays(TAG, "competitive")     # probe sees it: re-read
        m4 = source.last_read()
        self.assertEqual((m4["readPath"], m4["visibleAsOf"], m4["latestVisibleBattle"],
                          m4["visibleRows"]), ("miss", "20990101T000030.000Z", newer, 13))
        self.assertIn(newer, [p.battle_time for p in plays])

    def test_tracked_is_tristate(self):
        self.assertIs(source.tracked_state(TAG), False)
        self.track()
        self.assertIs(source.tracked_state(TAG), True)
        with mock.patch.object(cd, "resolve_db_path", lambda: None):
            self.assertIsNone(source.tracked_state(TAG))
        P.predict_for_tag(TAG, "competitive", record_shadow=True)
        self.assertIs(self.log()[-1]["tracked"], True)


# --------------------------------------------------------------------------- 6-9
def entry(eid="a1", player="p1", domain="competitive", anchor="20260901T100000.000Z",
          latest="20260901T100000.000Z", vis="20260901T110000.000Z",
          req="20260901T120000.000Z", stamp="20260901T120001.000Z", schema=2,
          primary=None, ts="2026-09-01T12:00:02Z"):
    e = {"id": eid, "player": player, "domain": domain, "anchorTs": anchor, "ts": ts,
         "confidence": "high", "pChange": 0.1,
         "primaryHash": shadow.deck_hash(primary or deck("knight")), "altHashes": []}
    if schema >= 2:
        e.update(schema=2, latestVisibleBattle=latest, visibleAsOf=vis,
                 requestedAt=req, requestStamp=stamp)
    return e


def dp(t, extra="knight", cards=None):
    return DeckPlay(battle_time=t, mode="Ladder", cards=tuple(cards or deck(extra)))


HORIZON = "20260930T000000.000Z"


class Outcomes(unittest.TestCase):

    def test_outcome_ordering(self):
        """6. T1 is strictly after the request stamp; a battle played before the
        request but after the anchor is T2's answer and never T1's."""
        e = entry()
        plays = {"p1": {"competitive": [
            dp("20260901T100000.000Z"),                     # the anchor itself
            dp("20260901T113000.000Z", "ice-golem"),        # after anchor, before request
            dp("20260901T120001.000Z", "ice-golem"),        # TIE with the stamp
            dp("20260901T130000.000Z", "knight")]}}
        t1 = shadow.outcomes_v2([e], plays, HORIZON, "T1")["a1"]
        t2 = shadow.outcomes_v2([e], plays, HORIZON, "T2")["a1"]
        self.assertEqual((t1["status"], t1["battleTime"]), ("scored", "20260901T130000.000Z"))
        self.assertEqual((t2["status"], t2["battleTime"]), ("scored", "20260901T113000.000Z"))
        self.assertTrue(t2["t2BeforeRequest"])
        self.assertFalse(t1["t2BeforeRequest"])
        for bad in (entry(vis="20260901T130000.000Z"),               # read after the stamp
                    entry(latest="20260901T115000.000Z", vis="20260901T110000.000Z"),
                    entry(req="20260901T120005.000Z"),               # requested after stamp
                    entry(anchor="20260901T100001.000Z")):           # anchor beyond latest
            self.assertEqual(shadow.outcomes_v2([bad], plays, HORIZON)["a1"]["status"],
                             "order_violation")

    def test_missing_outcome_censored(self):
        """8. No later battle, or one only beyond the data horizon, is CENSORED
        and never scored as wrong."""
        e = entry()
        none_yet = {"p1": {"competitive": [dp("20260901T100000.000Z")]}}
        too_late = {"p1": {"competitive": [dp("20261005T000000.000Z", "ice-golem")]}}
        for plays in (none_yet, too_late, {"p1": {}}):
            o = shadow.outcomes_v2([e], plays, HORIZON)
            self.assertEqual(o["a1"]["status"], "censored")
            r = shadow.reconcile_v2([e], o)["competitive"]
            self.assertEqual(r["total"], 0)
            self.assertEqual(r["bands"], {})
        self.assertEqual(shadow.outcomes_v2([e], {}, HORIZON)["a1"]["status"], "unresolvable")
        bad = {"p1": {"competitive": [dp("20260901T130000.000Z", cards=("a",) * 8)]}}
        self.assertEqual(shadow.outcomes_v2([e], bad, HORIZON)["a1"]["status"],
                         "malformed_outcome")
        with self.assertRaises(ValueError):
            shadow.outcomes_v2([e], none_yet, "")          # the horizon is required

    def test_outcome_edge_cases(self):
        """6b. Multiple later battles: the FIRST is the outcome. A duplicate row
        (same instant, same deck) is one outcome; the same instant with two
        different decks is ambiguous. A battle with no timestamp is never next."""
        e = entry()
        several = {"p1": {"competitive": [dp("20260901T150000.000Z", "valkyrie"),
                                          dp("20260901T130000.000Z", "ice-golem"),
                                          dp("20260901T140000.000Z", "knight")]}}
        o = shadow.outcomes_v2([e], several, HORIZON)["a1"]
        self.assertEqual((o["status"], o["battleTime"]), ("scored", "20260901T130000.000Z"))
        same = {"p1": {"competitive": [dp("20260901T130000.000Z"), dp("20260901T130000.000Z")]}}
        self.assertEqual(shadow.outcomes_v2([e], same, HORIZON)["a1"]["status"], "scored")
        split = {"p1": {"competitive": [dp("20260901T130000.000Z", "knight"),
                                        dp("20260901T130000.000Z", "valkyrie")]}}
        self.assertEqual(shadow.outcomes_v2([e], split, HORIZON)["a1"]["status"],
                         "ambiguous_outcome")
        undated = {"p1": {"competitive": [dp("", "valkyrie")]}}
        self.assertEqual(shadow.outcomes_v2([e], undated, HORIZON)["a1"]["status"], "censored")

    def test_duplicate_requests_distinct(self):
        """9. Two observations of one player in one second are two outcomes.
        Schema 1's (player, ts) key cannot tell them apart."""
        # Same player, same record second, different prediction moments: a
        # battle lands between the two stamps, so their true outcomes differ.
        a = entry("a1", vis="20260901T115955.000Z", req="20260901T115950.000Z",
                  stamp="20260901T115958.000Z", ts="2026-09-01T12:00:02Z",
                  primary=deck("ice-golem"))
        b = entry("b2", stamp="20260901T120001.000Z", ts="2026-09-01T12:00:02Z",
                  primary=deck("knight"))
        plays = {"p1": {"competitive": [dp("20260901T120000.000Z", "ice-golem"),
                                        dp("20260901T130000.000Z", "knight")]}}
        o = shadow.outcomes_v2([a, b], plays, HORIZON)
        self.assertEqual({k: (v["status"], v["battleTime"]) for k, v in o.items()},
                         {"a1": ("scored", "20260901T120000.000Z"),
                          "b2": ("scored", "20260901T130000.000Z")})
        r = shadow.reconcile_v2([a, b], o)["competitive"]
        self.assertEqual((r["total"], r["bands"]["high"]["correct"]), (2, 2))
        v1 = shadow.outcomes_from_history([a, b], plays)
        self.assertEqual(len(v1), 1)                         # the collision, demonstrated
        dupe = shadow.outcomes_v2([a, dict(a)], plays, HORIZON)
        self.assertEqual(dupe["a1"]["status"], "ambiguous_id")


# --------------------------------------------------------------------------- 7, 10-12
class LogShape(TempWorld):

    def test_no_raw_tag(self):
        """7. No raw tag reaches the log, even when a caller tries to put one in."""
        r = P.predict(TAG, "competitive", source.load_plays(TAG, "competitive"))
        shadow.record(TAG, "competitive", r, 10, 5, 1.0, anchor_ts="20260901T100000.000Z",
                      measurement={"tag": TAG, "requestStamp": TAG, "readPath": TAG,
                                   "visibleAsOf": "2026-09-01 10:00", "tracked": "yes",
                                   "visibleRows": True})
        P.predict_for_tag(TAG, "competitive", record_shadow=True)
        with open(shadow.LOG_PATH, encoding="utf-8") as fh:
            raw = fh.read()
        self.assertNotIn(TAG, raw)
        self.assertNotIn(TAG.lstrip("#"), raw)
        e = self.log()[0]
        self.assertNotIn("tag", e)
        self.assertEqual((e["requestStamp"], e["readPath"], e["visibleAsOf"],
                          e["tracked"], e["visibleRows"]), ("", "", "", None, None))
        self.assertEqual(e["player"], shadow._hash(TAG))

    def test_version_isolation(self):
        """10. Schema 1 and 2 are told apart; T1 is never asked of a schema-1
        record; the model/feature stamp is unchanged by a schema bump."""
        self.assertEqual(shadow.VERSIONS["features"], "phase2-21-reqstamp-utc-x9zero")
        v1 = entry("old", schema=1)
        self.assertNotIn("schema", v1)
        plays = {"p1": {"competitive": [dp("20260901T130000.000Z")]}}
        self.assertEqual(shadow.outcomes_v2([v1], plays, HORIZON, "T1")["old"]["status"],
                         "missing_fields")
        self.assertEqual(shadow.outcomes_v2([v1], plays, HORIZON, "T2")["old"]["status"],
                         "scored")
        # a requestStamp on a record the schema-2 writer did not produce is
        # not trusted: T1 needs the whole contract, not one field of it
        forged = dict(v1, requestStamp="20260901T120001.000Z")
        self.assertEqual(shadow.outcomes_v2([forged], plays, HORIZON, "T1")["old"]["status"],
                         "missing_fields")
        with open(shadow.LOG_PATH, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(dict(v1, versions=dict(shadow.VERSIONS))) + "\n")
        P.predict_for_tag(TAG, "competitive", record_shadow=True)
        v = shadow.verify_log(shadow.LOG_PATH)
        self.assertEqual(v["schemaVersions"], {"1": 1, "2": 1})
        self.assertTrue(v["ok"])
        self.assertIn("schemas", shadow.verify_report(v))
        # engine fallback: no stamp was used, so T1 must refuse it
        fb = entry("fb", stamp="")
        self.assertEqual(shadow.outcomes_v2([fb], plays, HORIZON)["fb"]["status"],
                         "missing_fields")

    def test_historical_compatibility(self):
        """11. Schema-1 records still flow through every existing function with
        the answers they always gave."""
        e = entry("h1", schema=1)
        plays = {"p1": {"competitive": [dp("20260901T100000.000Z"),
                                        dp("20260901T130000.000Z")]}}
        truth = shadow.outcomes_from_history([e], plays)
        self.assertEqual(truth, {("p1", e["ts"]): shadow.deck_hash(deck("knight"))})
        r = shadow.reconcile([e], truth)
        self.assertEqual((r["total"], r["bands"]["high"]["correct"]), (1, 1))
        real = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "ml", "results", "shadow-log.jsonl")
        if os.path.exists(real):                             # read-only, local only
            v = shadow.verify_log(real)
            self.assertEqual(set(v["schemaVersions"]), {"1"})
            self.assertEqual(v["schemaVersions"]["1"], v["records"])

    def test_failure_isolation(self):
        """12. A failing measurement can never change or fail a prediction."""
        baseline = P.predict_for_tag(TAG, "competitive").as_dict()
        boom = mock.Mock(side_effect=RuntimeError("boom"))
        for target, attr in ((shadow, "_append"), (source, "tracked_state"),
                             (source, "last_read"), (P, "last_stamp"),
                             (shadow, "_measurement")):
            source.clear_cache()
            with mock.patch.object(target, attr, boom):
                try:
                    got = P.predict_for_tag(TAG, "competitive", record_shadow=True)
                except RuntimeError:
                    self.fail("%s.%s leaked an exception" % (target.__name__, attr))
                self.assertEqual(got.as_dict(), baseline, attr)
        with mock.patch.object(cd, "resolve_db_path", lambda: None):
            self.assertIsNone(source.tracked_state(TAG))


if __name__ == "__main__":
    unittest.main(verbosity=1)
