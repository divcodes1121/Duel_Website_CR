"""The card manual as living data: the balance log's reader, the extractor's
parser for it, and the two role readers re-reading their file when it changes.

No database. Run directly:

    python server/test_card_balance.py
"""
from __future__ import annotations

import datetime
import importlib.util
import json
import os
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import card_balance as cb  # noqa: E402
import card_counters as cc  # noqa: E402
import deck_harmony as dh  # noqa: E402

PASS = FAIL = 0
NL = chr(10)


def check(name: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name}  {detail}")


TMP = tempfile.mkdtemp(prefix="cardbalance-")


def write(name: str, doc) -> str:
    path = os.path.join(TMP, name)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh)
    return path


def table(cards: dict, latest="2026-10-06", patches=1) -> dict:
    return {"version": 1, "latest": latest, "patches": [{}] * patches, "cards": cards}


TODAY = datetime.date(2026, 10, 10)
_real_path = cb.PATH

# ── 1. The shipped file ─────────────────────────────────────────────────────

print("the shipped balance log")
cb.reload()
st = cb.status()
check("it is loaded", st["loaded"] and st["cards"] >= 60 and st["patches"] >= 7, str(st))
check("it names its newest patch", st["latest"] and st["latest"] >= "2026-10-06", str(st))
shipped = json.load(open(_real_path, encoding="utf-8"))
roster = {c["key"] for c in dh.CARDS.values()}
check("every card in it is a card of the roster", set(shipped["cards"]) <= roster,
      str(set(shipped["cards"]) - roster))
check("every change has a date, a form and a kind from the closed lists",
      all(r["form"] in ("base", "evolution", "hero")
          and r["kind"] in ("buff", "nerf", "rework", "fix", "new")
          and datetime.date.fromisoformat(r["date"])
          for rows in shipped["cards"].values() for r in rows))
check("the patches are dated, in order, one a date",
      [p["date"] for p in shipped["patches"]] == sorted({p["date"] for p in shipped["patches"]}))
check("the two forms of season 88 and the card of season 87 are in it as NEW",
      any(r["kind"] == "new" and r["form"] == "evolution" for r in shipped["cards"].get("electro-giant", []))
      and any(r["kind"] == "new" and r["form"] == "hero" for r in shipped["cards"].get("electro-wizard", []))
      and any(r["kind"] == "new" for r in shipped["cards"].get("minion-giant", [])))
check("the file says it is generated", "build-card-roles" in shipped.get("$comment", ""))

# ── 2. What a nerf is worth, and for how long ───────────────────────────────

print(NL + "a nerf, in points, fading")
cb.PATH = write("a.json", table({
    "ghost": [{"date": "2026-10-06", "form": "base", "kind": "nerf"}],
    "barrel": [{"date": "2026-10-06", "form": "base", "kind": "buff"}],
    "wizard": [{"date": "2026-10-06", "form": "evolution", "kind": "nerf"},
               {"date": "2026-10-06", "form": "hero", "kind": "nerf"},
               {"date": "2026-10-06", "form": "base", "kind": "buff"}],
    "icewiz": [{"date": "2026-10-06", "form": "hero", "kind": "nerf"}],
    "old": [{"date": "2026-07-01", "form": "base", "kind": "nerf"}],
    "twice": [{"date": "2026-09-10", "form": "base", "kind": "nerf"},
              {"date": "2026-10-06", "form": "base", "kind": "nerf"}],
    "tomorrow": [{"date": "2026-10-20", "form": "base", "kind": "nerf"}],
    "rework": [{"date": "2026-10-06", "form": "base", "kind": "rework"}],
    "bad": [{"date": "not a date", "form": "base", "kind": "nerf"}],
}))
cb.reload()
full = cb.NERF_POINTS["base"]
fade4 = 1.0 - 4 / cb.FADE_DAYS
check("a base nerf four days old is nearly the whole measured figure",
      abs(cb.card_drag("ghost", TODAY) - full * fade4) < 1e-9, str(cb.card_drag("ghost", TODAY)))
check("on the patch day it is the whole figure",
      abs(cb.card_drag("ghost", "2026-10-06") - full) < 1e-9)
check("half way through the fade it is half",
      abs(cb.card_drag("ghost", datetime.date(2026, 10, 6) + datetime.timedelta(days=cb.FADE_DAYS // 2))
          - full / 2) < 1e-9)
check("and after the fade it is nothing",
      cb.card_drag("ghost", datetime.date(2026, 10, 6) + datetime.timedelta(days=cb.FADE_DAYS)) == 0.0
      and cb.card_drag("old", TODAY) == 0.0)
check("a buff moves nothing (none was measured)", cb.card_drag("barrel", TODAY) == 0.0)
check("a rework moves nothing (it went both ways)", cb.card_drag("rework", TODAY) == 0.0)
check("a hero nerf is the smaller figure",
      abs(cb.card_drag("icewiz", TODAY) - cb.NERF_POINTS["hero"] * fade4) < 1e-9
      and cb.NERF_POINTS["hero"] < cb.NERF_POINTS["base"])
check("two forms nerfed in ONE patch are one change, the larger figure",
      abs(cb.card_drag("wizard", TODAY) - cb.NERF_POINTS["evolution"] * fade4) < 1e-9,
      str(cb.card_drag("wizard", TODAY)))
check("two patches are two changes, each on its own fade",
      abs(cb.card_drag("twice", TODAY) - full * (fade4 + 1.0 - 30 / cb.FADE_DAYS)) < 1e-9,
      str(cb.card_drag("twice", TODAY)))
check("a patch dated after the day asked about is not applied",
      cb.card_drag("tomorrow", TODAY) == 0.0)
check("a row with no readable date is not a change", cb.card_drag("bad", TODAY) == 0.0)
check("a card the log does not name is not moved", cb.card_drag("knight", TODAY) == 0.0)

print(NL + "a deck")
check("a deck with no changed card is not moved",
      cb.drag(["knight", "archers", "barrel", "rework"], TODAY) == 0.0)
one = cb.drag(["ghost", "a", "b", "c", "d", "e", "f", "g"], TODAY)
check("one nerfed card is that card's figure", abs(one - round(full * fade4, 2)) < 1e-9, str(one))
two = cb.drag(["ghost", "icewiz", "b", "c", "d", "e", "f", "g"], TODAY)
check("a second nerfed card counts for HALF of its own",
      cb.SECOND_CARD == 0.5
      and abs(two - round(full * fade4 + 0.5 * cb.NERF_POINTS["hero"] * fade4, 2)) < 1e-9
      and one < two < one + cb.NERF_POINTS["hero"] * fade4 - 0.05, str(two))
check("a deck is never moved past the cap",
      cb.drag(["ghost", "twice", "wizard", "icewiz"], TODAY) == cb.MAX_DRAG)
check("a card listed twice counts once",
      cb.drag(["ghost", "ghost"], TODAY) == one)
check("the default day is today, and it answers", cb.drag(["ghost"]) >= 0.0)

print(NL + "the marks on a row")
ms = cb.marks(["ghost", "barrel", "old", "knight", "wizard", "tomorrow"], TODAY)
check("recent changes are marked, one row a card",
      sorted(m["card"] for m in ms) == ["barrel", "ghost", "wizard"], str(ms))
check("each says what happened and when",
      all(m["kind"] in ("nerf", "buff", "rework", "new") and m["date"] == "2026-10-06" for m in ms))
check("an old change is not a mark, nor one not yet live",
      not any(m["card"] in ("old", "tomorrow") for m in ms))
check("a change older than the mark window is dropped",
      cb.marks(["ghost"], datetime.date(2026, 10, 6) + datetime.timedelta(days=cb.MARK_DAYS)) == [])

# ── 3. Living data: the file is re-read when it changes ─────────────────────

print(NL + "the file is re-read when it changes, without a restart")
live = write("live.json", table({"ghost": [{"date": "2026-10-06", "form": "base", "kind": "nerf"}]}))
cb.PATH = live
cb.reload()
check("first read", cb.card_drag("ghost", TODAY) > 0 and cb.card_drag("knight", TODAY) == 0.0)
write("live.json", table({"knight": [{"date": "2026-10-06", "form": "base", "kind": "nerf"}]},
                         latest="2026-10-09", patches=2))
os.utime(live, (time.time() + 5, time.time() + 5))
check("inside the check interval the table in hand answers",
      cb.card_drag("ghost", TODAY) > 0)
cb._state["checked"] = 0.0           # the interval has passed
check("after it, the new file is in use",
      cb.card_drag("knight", TODAY) > 0 and cb.card_drag("ghost", TODAY) == 0.0
      and cb.status()["latest"] == "2026-10-09", str(cb.status()))
with open(live, "w", encoding="utf-8") as fh:
    fh.write("{ not json")
os.utime(live, (time.time() + 10, time.time() + 10))
cb._state["checked"] = 0.0
check("a half-written file keeps the last good table",
      cb.card_drag("knight", TODAY) > 0)
cb.PATH = os.path.join(TMP, "absent.json")
cb.reload()
check("with no file nothing is moved and nothing is marked",
      cb.drag(["ghost", "knight"], TODAY) == 0.0 and cb.marks(["ghost"], TODAY) == []
      and cb.status()["loaded"] is False)
cb.PATH = _real_path
cb.reload()

# card_counters: the relations
_saved = (cc.ROLES, cc.BEATS, cc._ROLES_PATH, dict(cc._seen))
try:
    rp = write("roles.json", {"cards": {"ronin": {"counters": ["pekka"]}, "pekka": {}}})
    cc._ROLES_PATH = rp
    check("a forced refresh reads the file", cc.refresh(force=True) and cc.beats("ronin", "pekka")
          and not cc.beats("pekka", "ronin"))
    write("roles.json", {"cards": {"ronin": {}, "pekka": {"counters": ["ronin"]}}})
    os.utime(rp, (time.time() + 5, time.time() + 5))
    check("inside the interval nothing is re-read", cc.refresh() is False and cc.beats("ronin", "pekka"))
    cc._seen["checked"] = 0.0
    check("after it the new relations are in use",
          cc.refresh() is True and cc.beats("pekka", "ronin") and not cc.beats("ronin", "pekka"))
    cc._seen["checked"] = 0.0
    check("an unchanged file is not re-read", cc.refresh() is False)
    write("roles.json", {"cards": {}})
    os.utime(rp, (time.time() + 9, time.time() + 9))
    cc._seen["checked"] = 0.0
    check("an empty file does not blank the card view",
          cc.refresh() is False and cc.available() and cc.beats("pekka", "ronin"))
finally:
    cc.ROLES, cc.BEATS, cc._ROLES_PATH = _saved[0], _saved[1], _saved[2]
    cc._seen.clear()
    cc._seen.update(_saved[3])

# deck_harmony: the roles behind the checklist
_saved_dh = (dh.ROLES, dh._ROLES_FILE, dict(dh._seen))
try:
    real = json.load(open(dh._ROLES_FILE, encoding="utf-8"))
    was = dh.answers_air("knight")
    real["cards"]["knight"] = dict(real["cards"]["knight"], hitsAir=True)
    hp = write("cardRoles.json", real)
    dh._ROLES_FILE = hp
    dh._load_real = dh._load
    dh._load = lambda name: (json.load(open(hp, encoding="utf-8")) if name == "cardRoles.json"
                             else dh._load_real(name))
    dh._seen["checked"] = 0.0
    dh._seen["mtime"] = None
    check("the checklist's roles are re-read when the file changes",
          was is False or was is None or not was)
    check("...a refresh picks the new file up", dh.refresh() is True and bool(dh.answers_air("knight")))
    dh._seen["checked"] = 0.0
    check("...and an unchanged file is left alone", dh.refresh() is False)
finally:
    if hasattr(dh, "_load_real"):
        dh._load = dh._load_real
        del dh._load_real
    dh.ROLES, dh._ROLES_FILE = _saved_dh[0], _saved_dh[1]
    dh._seen.clear()
    dh._seen.update(_saved_dh[2])
check("the shipped roles are back", not dh.answers_air("knight"))

# ── 4. The extractor's parser for the balance log ───────────────────────────

print(NL + "the extractor reads the manual's balance log")
spec = importlib.util.spec_from_file_location(
    "build_card_roles", os.path.join(ROOT, "scripts", "build-card-roles.py"))
bcr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bcr)

TICKS = chr(96) * 3


def block(*lines: str) -> str:
    return "text before" + NL + TICKS + "text" + NL + NL.join(lines) + NL + TICKS + NL


ROSTER = {"knight", "wizard", "minion-giant"}
good = block("BALANCE_PATCH:2026-10-06", "SEASON:88", "CONFIDENCE:community",
             "CHANGE:knight|base|nerf|hit points -4%",
             "CHANGE:wizard|evolution|buff|shield +10% | and more",
             "NEW:minion-giant|base|a flying win condition")
got = bcr.parse_balance(good, ROSTER)
check("a patch block is read", len(got) == 1 and got[0]["date"] == "2026-10-06"
      and got[0]["season"] == "88" and got[0]["confidence"] == "community", str(got))
check("its changes carry card, form, kind and the text as written",
      got[0]["changes"][0] == {"card": "knight", "form": "base", "kind": "nerf", "text": "hit points -4%"}
      and got[0]["changes"][1]["text"] == "shield +10% | and more", str(got[0]["changes"]))
check("a new card or form is listed apart",
      got[0]["new"] == [{"card": "minion-giant", "form": "base", "text": "a flying win condition"}])
check("a card's tag block is not a patch", bcr.parse_balance(block("CARD:knight", "TYPE:troop"), ROSTER) == [])
both = good + block("BALANCE_PATCH:2026-08-04", "CHANGE:knight|base|buff|damage +5%")
check("patches come back oldest first",
      [p["date"] for p in bcr.parse_balance(both, ROSTER)] == ["2026-08-04", "2026-10-06"])


def refuses(text: str) -> bool:
    try:
        bcr.parse_balance(text, ROSTER)
    except SystemExit:
        return True
    return False


check("a card the roster does not have is an ERROR, not a dropped line",
      refuses(block("BALANCE_PATCH:2026-10-06", "CHANGE:nobody|base|nerf|x")))
check("so is a form outside the three",
      refuses(block("BALANCE_PATCH:2026-10-06", "CHANGE:knight|champion|nerf|x")))
check("and a kind outside the four",
      refuses(block("BALANCE_PATCH:2026-10-06", "CHANGE:knight|base|tweak|x")))
check("and a line missing a field",
      refuses(block("BALANCE_PATCH:2026-10-06", "CHANGE:knight|base|nerf")))
check("and two blocks with one date", refuses(good + good))
check("the shipped manual and the shipped file agree",
      (not os.path.exists(bcr.REPO_MANUAL))
      or bcr.build_balance(bcr.REPO_MANUAL)["cards"] == shipped["cards"])

print(f"{NL}{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
