"""DECKS AROUND THE CARDS THE PLAYER NAMES — Coach Assist's "your cards".

Asked for (2026-10-02): "the decks it gave, the player might not play — so we
tell it to give us decks by our choice: we enter the win conditions or cards,
it finds and makes the decks accordingly, shows the matchup percentage,
prioritises duel battles and the brain's deck making".

Coach Assist's answer is chosen from the player's own history and the meta. A
coach who knows their player wants Graveyard, or will not give up Fireball, had
no way to say so. This is that control: up to `MAX_WANT` cards, every deck
returned holds ALL of them, and each is rated against the opponent's likely
decks by the same brain that ranks "Play this".

WHERE THE DECKS COME FROM, and the order they are shown in:

  duel    decks duel players repeatedly field (`duel_index.catalogue`) — the
          section the screen leads with
  yours   decks the player has actually played that hold the cards
  meta    vetted ladder decks (`deck_counter.seeds`)
  built   decks Deckkies builds around the cards from how duel players build
          (`deck_architect.py`): a shell's core, plus the open slots chosen
          against this opponent

THE FIRST CUT GOT TWO THINGS WRONG, both reported the day it shipped:

  * ITS "BUILT" DECKS WERE A SUBSTITUTION — a real Balloon deck with Balloon
    swapped for Graveyard. "That is not how it works." That path (`forced`) is
    deleted; `deck_architect` builds from the shells duel players really play.
  * IT RATED THE WRONG DUEL DECKS. The lists sent to the combined brain were
    the quick model's favourites, so of 148 Graveyard lists in the duel
    catalogue the one shown had 14 duel games while the most-played list —
    1,348 duel games across 841 players — was never rated at all. HALF the
    duel lists rated are now simply the most duel-played (`EVIDENCE_FIRST`),
    and a list under `PROVEN_GAMES` duel games ranks after every proven one
    (`thin`) — evidence before size, the swap tuner's rule.

RULES, each a function below and each tested against literals:

  * every named card is in every deck returned (`holds`);
  * no card already spent this duel (`legal`) — a named card that IS spent is
    reported, never silently ignored;
  * a duel-proven deck leads another within `DUEL_BAND` points and nothing
    outside it (`order`);
  * near-copies are one answer, and the player's own deck is the one that
    stands for them (`arrange`).

Pure: no database, no network, no imports beyond the standard library.
`coach.chosen` gathers the candidates and rates them.
"""

from __future__ import annotations

BRAIN = "coach-choice-2.0"

#: Cards a reader may name. Four leaves four free slots; past that the request
#: is a whole deck and there is nothing left to find.
MAX_WANT = 4

#: Decks shown, per section. Duel decks lead and get the most room.
SHOW = {"duel": 4, "yours": 2, "meta": 2, "built": 3}

#: Lists rated by the combined brain, per source. It reads a list's ladder
#: history the first time it rates it, so this is the cost lever
#: (`coach.BUILD_FINALISTS`). They sum to `FINALISTS`.
QUOTA = {"yours": 4, "duel": 10, "meta": 4, "built": 8}
FINALISTS = sum(QUOTA.values())

#: Sources where HALF the quota goes to the most-played lists before the quick
#: model's favourites get the rest. See the module note.
EVIDENCE_FIRST = ("duel",)

#: Duel games under which a duel list is THIN: shown, ranked after every
#: proven one. `deck_synergy.PROVEN_GAMES`' figure for the same claim.
PROVEN_GAMES = 30

#: Points of win chance inside which a duel-proven deck leads one that is not.
#: `coach.LEAD_MARGIN`'s figure, for the same claim.
DUEL_BAND = 3.0

#: Shared cards at which two BUILT decks are one answer.
SAME_BUILD = 7

#: The order of trust — which source keeps a deck two of them hold.
SOURCES = ("yours", "duel", "meta", "built")

#: The order sections are SHOWN in.
SECTIONS = ("duel", "yours", "meta", "built")


def deck_key(cards) -> str:
    return ",".join(sorted(set(cards or [])))


def valid_want(raw, known) -> tuple[list[str], list[str]]:
    """`(want, dropped)`: the named cards this deployment knows, in the order
    given, de-duplicated and capped at `MAX_WANT`; and what was left out.

    An unknown key is DROPPED AND ECHOED, never an error — the catalogue moves
    (a season's new card), and a refusal would blank the control on the day it
    does. Keys are lower-cased and spaces become hyphens, as the 2v2 filter
    does, so "Hog Rider" is `hog-rider`.
    """
    want: list[str] = []
    dropped: list[str] = []
    known = set(known or ())
    for r in raw or []:
        k = str(r or "").strip().lower().replace(" ", "-")
        if not k or k in want or k in dropped:
            continue
        if k in known and len(want) < MAX_WANT:
            want.append(k)
        else:
            dropped.append(k)
    return want, dropped


def holds(cards, want) -> bool:
    """Eight distinct cards that include every named one."""
    s = set(cards or [])
    return len(s) == 8 and set(want or ()) <= s


def legal(cards, used) -> bool:
    """No card already spent this duel — the rule every recommendation follows."""
    return not (set(cards or []) & set(used or ()))


def shortlist(cands: list[dict], limit: int = FINALISTS, quota: dict | None = None) -> list[dict]:
    """The lists worth the combined brain's time, source by source.

    `cands` carry `source`, `fast` (the quick model's win chance, or None) and
    `plays` (games behind the list). Within a source the quick model's best
    come first — except in `EVIDENCE_FIRST` sources, where half the quota is
    the MOST-PLAYED lists, so the lists with the most real duels behind them
    are always rated. A candidate marked `pin` is taken first whatever its
    rank (the builder's own pick when it is a real list). Slots a source
    cannot fill go to the best of what is left. One entry per deck — the first
    source to hold it keeps it, and `SOURCES` is the order of trust.
    """
    quota = dict(QUOTA if quota is None else quota)

    def rank(c):
        f = c.get("fast")
        return (f is None, -(f or 0.0), -int(c.get("plays") or 0), deck_key(c["cards"]))

    def played(c):
        return (-int(c.get("plays") or 0), deck_key(c["cards"]))

    seen: set[str] = set()
    out: list[dict] = []
    rest: list[dict] = []
    for s in SOURCES:
        pool: list[dict] = []
        for c in sorted((c for c in cands if c.get("source") == s), key=rank):
            k = deck_key(c["cards"])
            if k in seen:
                continue
            seen.add(k)
            pool.append(c)
        q = max(0, int(quota.get(s, 0)))
        take: list[dict] = [c for c in pool if c.get("pin")][:q]

        def add(c) -> bool:
            if len(take) < q and not any(c is t for t in take):
                take.append(c)
                return True
            return False

        if s in EVIDENCE_FIRST:
            by_play = (q + 1) // 2
            for c in sorted(pool, key=played):
                if by_play <= 0:
                    break
                if add(c):
                    by_play -= 1
        for c in pool:
            add(c)
        out.extend(take)
        rest.extend(c for c in pool if not any(c is t for t in take))
    rest.sort(key=rank)
    out.extend(rest[:max(0, limit - len(out))])
    return out[:limit]


def proven(row: dict) -> bool:
    """Whether a row's duel record clears the duel brain's strength gate."""
    return bool((row.get("duel") or {}).get("strong"))


def thin(row: dict) -> bool:
    """A duel list with too few duel games behind it to rank beside a proven
    one. Only duel lists can be thin: the player's own deck and a ladder deck
    are not on the list for their duel record."""
    return row.get("source") == "duel" and int(row.get("plays") or 0) < PROVEN_GAMES


def order(rows: list[dict], band: float = DUEL_BAND) -> list[dict]:
    """Best first. Rated rows before unrated; a thin duel list after every
    proven one; then the win chance — with a duel-proven row treated as `band`
    points higher, which is exactly "it leads anything within the band and
    nothing outside it". Ties: proof, games, the deck key.
    """
    def key(r):
        w = r.get("win")
        eff = None if w is None else float(w) + (band if proven(r) else 0.0)
        return (eff is None, thin(r), -(eff or 0.0), not proven(r),
                -int(r.get("plays") or 0), deck_key(r["cards"]))
    return sorted(rows, key=key)


def same_at(want) -> int:
    """Shared cards at which two answers are one. Six, the site's rule — seven
    once four cards are named, because every answer then already shares four."""
    return 7 if len(want or ()) >= 4 else 6


def arrange(rows: list[dict], want=(), show: dict | None = None) -> list[dict]:
    """The list as shown: duel decks, the player's own, the meta, then built.
    Each returned row carries `section`.

    Each section is in `order` and capped by `show`. A near-copy of a deck
    already taken is not a second answer — and the sections CLAIM in the order
    of trust (the player's own first), so when their deck and a duel list are
    one deck apart it is theirs that stands. A built deck is dropped only when
    it IS a deck already shown; a card or two from a real list is what a build
    usually is, and the row says how close.

    A real list the builder itself arrived at (`architect` on a non-built row)
    that did not make its own section is shown with the built decks, so the
    brain's pick is never lost to a cap.
    """
    show = dict(SHOW if show is None else show)
    at = same_at(want)
    ordered = order(rows)
    taken: list[dict] = []
    by: dict[str, list[dict]] = {s: [] for s in SECTIONS}

    for s in SOURCES:
        if s == "built":
            continue
        for r in ordered:
            if r.get("source") != s or len(by[s]) >= show.get(s, 0):
                continue
            if any(len(set(r["cards"]) & set(t["cards"])) >= at for t in taken):
                continue
            by[s].append(r)
            taken.append(r)

    # ONE BUILD PER WAY OF PLAYING THE CARD FIRST, then the rest. Staged, two
    # of three built Graveyard decks were the same Freeze shell with one card
    # different while three other shells went unshown.
    shown = {deck_key(t["cards"]) for t in taken}
    made = [r for r in ordered
            if (r.get("source") == "built" or r.get("architect"))
            and deck_key(r["cards"]) not in shown]
    shells: set = set()
    for first_of_shell in (True, False):
        for r in made:
            if len(by["built"]) >= show.get("built", 0):
                break
            if any(r is m for m in by["built"]):
                continue
            rank = ((r.get("architect") or {}).get("shell") or {}).get("rank")
            if first_of_shell and rank in shells:
                continue
            if any(len(set(r["cards"]) & set(m["cards"])) >= SAME_BUILD for m in by["built"]):
                continue
            by["built"].append(r)
            shells.add(rank)
    by["built"] = [r for r in ordered if any(r is m for m in by["built"])]

    out = []
    for s in SECTIONS:
        for r in by[s]:
            r["section"] = s
            out.append(r)
    return out
