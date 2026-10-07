"""test_duel_read.py — the duel read's rules, and its trainer's blindness.

    python server/test_duel_read.py

No database. `duel_read` is pure and is handed its history, so every rule is
checked against literals; the trainer is driven with a few hand-built duels.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import duel_read as dr  # noqa: E402
import duel_read_train as T  # noqa: E402

PASS = 0
FAIL = 0


def check(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok   {label}")
    else:
        FAIL += 1
        print(f"  FAIL {label} {detail}")


def deck(name, *swap):
    """Eight cards named after `name`; `swap=(i, card)` replaces card i."""
    cards = [f"{name}-{i}" for i in range(8)]
    for i in range(0, len(swap), 2):
        cards[swap[i]] = swap[i + 1]
    return cards


DAY = 86400.0
NOW = 1_000_000_000.0
A, B, C, D, E = deck("a"), deck("b"), deck("c"), deck("d"), deck("e")


def duel(days_ago, decks, won=None, friendly=False):
    return {"t": NOW - days_ago * DAY, "decks": decks, "won": won if won is not None else [True] * len(decks),
            "friendly": friendly}


def top(history, revealed=(), **kw):
    rows = dr.read(history, list(revealed), NOW, **kw)
    return rows[0]["cards"] if rows else None


# ── the contract ───────────────────────────────────────────────────────────
print("\nthe feature lists are a contract")
check("twelve ranking features, in the fitted order",
      dr.FEATURES == ("presence", "position", "in_last", "pos_last", "share", "winrate", "staleness",
                      "with_revealed", "follows", "lost_x_winrate", "lost_x_share", "n_variants"))
check("every default table has one row per stage and one weight per feature",
      all(len(dr.DEFAULT_WEIGHTS[s]) == len(dr.FEATURES)
          and len(dr.DEFAULT_SHARPNESS[s]) == len(dr.SHARPNESS_FEATURES)
          and len(dr.DEFAULT_NOVELTY[s]) == len(dr.NOVELTY_FEATURES) for s in (0, 1, 2)))
check("a fourth game of a best-of-5 reads with the two-reveal weights",
      dr.stage_of([A, B, C]) == 2 and dr.stage_of([]) == 0)

# ── legality ───────────────────────────────────────────────────────────────
print("\na predicted deck must be playable")
SHARES_ONE = deck("s", 0, A[0])
h = [duel(3, [A, SHARES_ONE, B]), duel(2, [A, SHARES_ONE, B]), duel(1, [A, SHARES_ONE, B])]
feats = dr.candidates(h, [A], NOW)
check("a deck sharing ONE card with a revealed deck is not a candidate",
      frozenset(SHARES_ONE) not in feats and frozenset(B) in feats, str(len(feats)))
check("the revealed deck itself is not a candidate", frozenset(A) not in feats)
check("nothing revealed, nothing excluded", len(dr.candidates(h, [], NOW)) == 3)
check("no history is no answer", dr.read([], [], NOW) == [] and dr.candidates([], [A], NOW) == {})
check("every deck spent leaves nothing to name",
      dr.read([duel(1, [A, B])], [A, B], NOW) == [])

# ── game order ─────────────────────────────────────────────────────────────
print("\nthe order of the games is read")
# B is played MORE (it is in every duel) but A is what they OPEN with.
h = [duel(4, [A, B]), duel(3, [A, B, C]), duel(2, [A, B]), duel(1, [A, B, C])]
check("the opener leads before game 1, not the most-played list",
      top(h) == A, str(top(h)))
check("after the opener, the deck that followed it leads", top(h, [A]) == B)
check("after both, the deck that came third leads", top(h, [A, B]) == C)
# The same decks in another order must give another opener.
h2 = [duel(4, [B, A]), duel(3, [B, A, C]), duel(2, [B, A]), duel(1, [B, A, C])]
check("reversing the stored order reverses the read", top(h2) == B and top(h2, [B]) == A)

# ONLY THE POSITION CAN SEPARATE THESE TWO. Z opens and A follows in three
# duels, then a duel with neither: plays, share, staleness and the last duel
# are all level, and a tie would break on the signature — toward A.
ZED = deck("z")
h3 = [duel(4, [ZED, A]), duel(3, [ZED, A]), duel(2, [ZED, A]), duel(1, [C, D])]
f3 = dr.candidates(h3, [], NOW)
pi = dr.FEATURES.index("position")
check("only the deck that opened is counted at the opening position",
      f3[frozenset(ZED)][pi] > 0 and f3[frozenset(A)][pi] == 0.0, str(f3[frozenset(A)]))
rk = [r["cards"] for r in dr.read(h3, [], NOW)]
check("...and that alone ranks it above a deck level on everything else",
      rk.index(ZED) < rk.index(A), str([c[0] for c in rk]))

# ── recency ────────────────────────────────────────────────────────────────
print("\na deck dropped weeks ago is not their deck now")
h = [duel(d, [A, B]) for d in (29, 28, 27, 26, 25, 24)] + [duel(2, [C, D]), duel(1, [C, D])]
check("six old duels lose to two recent ones", top(h) == C, str(top(h)))
check("...and a count of plays would have said the old opener",
      T._counts_top(h, [])[0] == frozenset(A))
fr_ = dr.candidates([duel(dr.HALF_LIFE_DAYS, [A, B]), duel(0, [C, D])], [], NOW)
pr, st = dr.FEATURES.index("presence"), dr.FEATURES.index("staleness")
check("a duel one half-life old counts half, one played now counts whole",
      abs(fr_[frozenset(A)][pr] - 0.5) < 1e-9 and abs(fr_[frozenset(C)][pr] - 1.0) < 1e-9,
      str(fr_[frozenset(A)][pr]))
import math  # noqa: E402
check("staleness is the days since THAT deck was last played",
      abs(fr_[frozenset(A)][st] - math.log1p(dr.HALF_LIFE_DAYS)) < 1e-9 and fr_[frozenset(C)][st] == 0.0)

# ── one row a deck ─────────────────────────────────────────────────────────
print("\ntwo lists a card apart are one deck")
A2 = deck("a", 7, "tech-card")
h = [duel(3, [A, B]), duel(2, [A2, B]), duel(1, [A, B])]
rows = dr.read(h, [], NOW)
ra = next(r for r in rows if len(set(r["cards"]) & set(A)) >= 7)
check("the variant is folded into its deck", len(rows) == 2 and ra["variants"] == 1, str(len(rows)))
check("...and its plays and probability with it", ra["plays"] == 3)
check("the rows are in the order of the figure printed beside them",
      [r["p"] for r in rows] == sorted((r["p"] for r in rows), reverse=True))

# ── probabilities ──────────────────────────────────────────────────────────
print("\nthe figures mean what they say")
h = [duel(3, [A, B, C]), duel(2, [A, B, C]), duel(1, [A, B, C])]
rows = dr.read(h, [], NOW)
total = sum(r["p"] for r in rows)
check("the rows sum to LESS than one", 0.0 < total < 1.0, str(total))
check("...and what is missing is the new-deck chance",
      abs((1.0 - total) - dr.novelty(h, [], NOW)) < 1e-9)
check("nothing legal to name is a new deck for certain", dr.novelty(h, [A, B, C], NOW) == 1.0)
varied = [duel(5, [A, B]), duel(4, [C, D]), duel(3, [E, deck("f")]), duel(2, [deck("g"), deck("h")]),
          duel(1, [deck("i"), deck("j")])]
check("a player who never repeats is more likely to bring a new deck",
      dr.novelty(varied, [], NOW) > dr.novelty(h, [], NOW),
      f"{dr.novelty(varied, [], NOW):.3f} vs {dr.novelty(h, [], NOW):.3f}")
check("their own new-deck rate is walked forward, shrunk",
      abs(dr.profile(varied)[0] - (8 + 1) / (8 + 2)) < 1e-9 and abs(dr.profile(h)[0] - 1 / 8) < 1e-9,
      str(dr.profile(varied)))
check("told the duel is friendly, a new deck is likelier than in a clan-war duel",
      dr.novelty(h, [], NOW, friendly_now=True) > dr.novelty(h, [], NOW, friendly_now=False))
fr = [duel(3, [A, B], friendly=True), duel(2, [A, B], friendly=True), duel(1, [A, B])]
check("not told, their friendly share stands in",
      dr.novelty_features(fr, [], NOW, 2)[-1] == dr.profile(fr)[1] == 2 / 3)

# ── unknown results ────────────────────────────────────────────────────────
print("\nan unknown result is not a loss")
h = [duel(1, [A, B], won=[None, None])]
f = dr.candidates(h, [], NOW)[frozenset(A)]
check("a deck with one unscored game has an even record", abs(f[dr.FEATURES.index("winrate")]) < 1e-9, str(f))
h = [duel(1, [A, B], won=[False, True])]
f = dr.candidates(h, [], NOW)
wi = dr.FEATURES.index("winrate")
check("a loss lowers it and a win raises it", f[frozenset(A)][wi] < 0 < f[frozenset(B)][wi])
h = [duel(2, [A, B]), duel(1, [A, C])]
f = dr.candidates(h, [A], NOW, lost_prev=True)[frozenset(B)]
g = dr.candidates(h, [A], NOW, lost_prev=False)[frozenset(B)]
check("the lost-the-last-game terms are off unless told",
      g[dr.FEATURES.index("lost_x_share")] == 0.0 and f[dr.FEATURES.index("lost_x_share")] > 0.0)

# ── determinism ────────────────────────────────────────────────────────────
print("\nidentical evidence, identical answer")
h = [duel(1, [A, B]), duel(1, [C, D])]
first = [tuple(r["cards"]) for r in dr.read(h, [], NOW)]
again = [tuple(r["cards"]) for r in dr.read(list(reversed(h)), [], NOW)]
check("the same duels in another list order rank the same", sorted(first) == sorted(again))
check("and twice in a row", first == [tuple(r["cards"]) for r in dr.read(h, [], NOW)])

# ── what they have left ────────────────────────────────────────────────────
print("\nwhat is spent is a fact; what is left is the read")
ROLE = {"a-0": "wincon", "a-1": "spell", "a-2": "building", "b-0": "wincon", "b-1": "spell",
        "c-0": "wincon", "c-1": "spell", "c-2": "spell"}


def role_of(c):
    return ROLE.get(c, "support")


h = [duel(3, [A, B, C]), duel(2, [A, B, C]), duel(1, [A, B, C])]
rows = dr.read(h, [A], NOW)
out = dr.left(rows, [A], role_of)
check("the revealed deck's cards are spent, by role",
      out["spent"]["wincon"] == ["a-0"] and out["spent"]["spell"] == ["a-1"]
      and out["spent"]["building"] == ["a-2"] and len(out["spent"]["support"]) == 5, str(out["spent"]))
check("no spent card is listed as left",
      not any(c["card"].startswith("a-") for cards in out["left"].values() for c in cards))
pb = next(r["p"] for r in rows if r["cards"] == B)
check("a card's chance is the chance of the decks holding it",
      next(c["prob"] for c in out["left"]["wincon"] if c["card"] == "b-0") == round(pb, 4))
check("each role is capped",
      all(len(out["left"][role]) <= limit for role, limit in dr.ROLE_LIMITS))
thin = [{"cards": B, "p": 0.9}, {"cards": C, "p": 0.04}]
check("a card under one deck in twenty is not listed",
      [c["card"] for c in dr.left(thin, [], role_of)["left"]["wincon"]] == ["b-0"])

# ── the artifact ───────────────────────────────────────────────────────────
print("\nan artifact is used only when it is this module's")
tmp = tempfile.mkdtemp()
path = os.path.join(tmp, "read.json")
W = {s: [float(i + s) for i in range(len(dr.FEATURES))] for s in (0, 1, 2)}
N = {s: [0.5] * len(dr.NOVELTY_FEATURES) for s in (0, 1, 2)}
S = {s: [0.25] * len(dr.SHARPNESS_FEATURES) for s in (0, 1, 2)}
check("with no file the defaults are in use",
      dr.weights_for(0, path) == dr.DEFAULT_WEIGHTS[0] and dr.status(path)["fitted"] is False)
dr.save(W, {"duels": 7, "trainedAt": "x"}, path=path, novelty=N, sharpness=S)
check("a saved fit is read back", dr.weights_for(1, path) == tuple(W[1])
      and dr.novelty_weights_for(2, path) == tuple(N[2]) and dr.sharpness_weights_for(0, path) == tuple(S[0]))
check("a stage past two clamps", dr.weights_for(4, path) == tuple(W[2]))
check("status says what is in use", dr.status(path) == {"brain": dr.BRAIN, "fitted": True, "trainedAt": "x",
                                                         "duels": 7, "holdout": None})
body = json.load(open(path))
body["features"] = list(reversed(body["features"]))
bad = os.path.join(tmp, "reordered.json")
json.dump(body, open(bad, "w"))
check("a reordered feature list is REFUSED, not read as weights", dr.load(bad) is None
      and dr.weights_for(0, bad) == dr.DEFAULT_WEIGHTS[0])
body = json.load(open(path))
del body["novelty"]
half = os.path.join(tmp, "half.json")
json.dump(body, open(half, "w"))
check("a file without the new-deck table keeps its ranking and takes the default for that part",
      dr.weights_for(0, half) == tuple(W[0]) and dr.novelty_weights_for(0, half) == dr.DEFAULT_NOVELTY[0])
open(os.path.join(tmp, "junk.json"), "w").write("{not json")
check("an unreadable file is no artifact", dr.load(os.path.join(tmp, "junk.json")) is None)

# ── the trainer is blind ───────────────────────────────────────────────────
print("\nthe trainer only ever shows a decision what came before it")


def games(rows):
    """(day, a_tag, b_tag, [(a deck, b deck, winner)], mode) -> index rows."""
    out = []
    for day, a, b, gs, mode in rows:
        bt = f"202609{day:02d}T120000.000Z"
        for i, (da, db, w) in enumerate(gs):
            out.append((bt, i, a, b, ",".join(sorted(da)), ",".join(sorted(db)), w, mode))
    return out


X, Y, Z = deck("x"), deck("y"), deck("z")
rows = games([
    (1, "#P", "#Q", [(A, X, 1), (B, Y, 2), (C, Z, 1)], "CW_Duel_1v1"),
    (2, "#P", "#R", [(A, X, 1), (B, Y, 1)], "Duel_1v1_Friendly"),
    (3, "#P", "#Q", [(A, X, 2), (B, Y, 1), (C, Z, 1)], "CW_Duel_1v1"),
])
players = T.players_of(rows)
p = players["#P"]
check("a player's duels come out oldest first, in game order",
      [d["decks"][0] for d in p] == [tuple(sorted(A))] * 3 and p[0]["won"] == [True, False, True])
check("the opponent's side is theirs", players["#Q"][0]["decks"][0] == tuple(sorted(X))
      and players["#Q"][0]["won"] == [False, True, False])
check("the friendly duel is marked", [d["friendly"] for d in p] == [False, True, False])
seen = list(T.decisions(players, 0, 10 ** 12))
check("the first duel of a player is not a decision (no history)",
      all(len(hist) >= 1 for _s, hist, _r, _t, _n, _l, _f in seen))
check("no decision sees a duel at or after its own time",
      all(h["t"] < now for _s, hist, _r, _t, now, _l, _f in seen for h in hist))
last = [d for d in seen if d[4] == p[2]["t"] and d[3] == frozenset(B) and len(d[1]) == 2]
check("the revealed decks are the ones before this game, and lost-the-last is theirs",
      len(last) == 1 and list(last[0][2]) == [tuple(sorted(A))] and last[0][5] is True, str(last[:1]))

# ── the trainer learns ─────────────────────────────────────────────────────
print("\nthe fit finds a habit that a count cannot")
synth = []
for i in range(60):
    tag = f"#S{i}"
    opener, second, spare = deck(f"o{i}"), deck(f"s{i}"), deck(f"x{i}")
    for day in range(1, 13):
        # The spare is played TWICE for every once of the opener, never first.
        gs = [(opener, X, 1), (spare, Y, 1)] if day % 2 else [(opener, X, 2), (second, Y, 1), (spare, Z, 1)]
        synth.append((day, tag, "#OPP", gs + [], "CW_Duel_1v1"))
old = (T.MAX_ROWS, T.EPOCHS)
T.EPOCHS = 3
model = T.fit(T.players_of(games(synth)), 0, 10 ** 12)
T.MAX_ROWS, T.EPOCHS = old
wpos = model["weights"][0][dr.FEATURES.index("position")] + model["weights"][0][dr.FEATURES.index("pos_last")]
check("the fitted weights reward the deck that opens", wpos > 0, str(model["weights"][0]))
rep = T.score(T.players_of(games(synth)), model, 0, 10 ** 12)
check("the read names the opener", rep["all"]["0"]["first"] > 90, str(rep["all"]["0"]))
check("every stage reports its count beside the read",
      all(k in rep["all"][s] for s in ("0", "1", "2") for k in ("first", "top3", "countsFirst", "countsTop3")))
check("friendly duels are reported on their own", rep["friendly"]["0"]["n"] == 0)
check("with no cohort there are the two built-in groups and no other", sorted(rep) == ["all", "friendly"])

print("\na named group of players is reported beside everyone")
import json as _json  # noqa: E402
import tempfile as _tempfile  # noqa: E402

players_s = T.players_of(games(synth))
rep_c = T.score(players_s, model, 0, 10 ** 12, {"crl": {"#S0", "#S1", "#S2"}, "empty": {"#NOBODY"}})
want = sum(1 for tag, d in T.tagged_decisions(players_s, 0, 10 ** 12) if tag in ("#S0", "#S1", "#S2") and d[0] == 0)
check("the group is the decisions of ITS players, and only those",
      rep_c["crl"]["0"]["n"] == want and 0 < want < rep_c["all"]["0"]["n"], f"{rep_c['crl']['0']['n']} {want}")
check("everyone is unchanged by adding a group", rep_c["all"] == rep["all"] and rep_c["friendly"] == rep["friendly"])
check("a group nobody in the data belongs to is reported as empty, not left out",
      rep_c["empty"]["0"]["n"] == 0 and rep_c["empty"]["calibration"] == [])
check("tags are matched whatever their case", T.score(players_s, model, 0, 10 ** 12, {"crl": {"#s0"}})["crl"]["0"]["n"] > 0)
check("a group cannot take a built-in name",
      T.score(players_s, model, 0, 10 ** 12, {"all": {"#S0"}})["all"] == rep["all"])
check("THE REPORT HOLDS NO TAG", "#S" not in _json.dumps(rep_c))
check("tagged_decisions is decisions with the player beside each",
      [d for _t, d in T.tagged_decisions(players_s, 0, 10 ** 12)] == list(T.decisions(players_s, 0, 10 ** 12)))

_tmp = _tempfile.mkdtemp()
_cp = os.path.join(_tmp, "cohorts.json")
with open(_cp, "w", encoding="utf-8") as _f:
    _json.dump({"CRL": ["#s0", " #S1 ", ""], "all": ["#S2"], "bad name": ["#S3"], "notalist": "#S4", "none": []}, _f)
got = T.load_cohorts(_cp)
check("the cohort file is read: names lower-cased, tags upper-cased and trimmed",
      got == {"crl": {"#S0", "#S1"}}, str(got))
check("a missing cohort file is no cohort, not an error", T.load_cohorts(os.path.join(_tmp, "absent.json")) == {})
with open(_cp, "w", encoding="utf-8") as _f:
    _f.write("not json")
check("an unreadable cohort file is no cohort", T.load_cohorts(_cp) == {})
with open(_cp, "w", encoding="utf-8") as _f:
    _json.dump(["#S0"], _f)
check("a cohort file that is not a table of groups is no cohort", T.load_cohorts(_cp) == {})

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
