"""Find a player by NAME, not just by tag.

The top bar's search could only ever take a tag. That is the right primary key
and a poor thing to ask a person for: nobody remembers `#9GJ0Q0LGG`, they
remember "Ninja Shoyo". This answers the other half — type a name, get the tags
it could be, pick one.

WHERE THE NAMES COME FROM. `player_names(tag, name)` is written by the bot on
every sync, so a name here is the one that player had when they were last
polled. That is the same freshness as everything else on the site, and it is
`clash_data.player_name`'s source too — this module is the same table read the
other way round, one name to many rather than one tag to one.

THREE THINGS THIS DELIBERATELY DOES NOT DO:

  * **It does not reach the CR API.** Supercell has no "search players by name"
    endpoint, so the only names we can offer are names we have stored. A player
    nobody has collected is unreachable by name and always will be — which is
    exactly why the field still takes a raw tag and submits it on Enter. This
    is an aid to finding someone we know, never the only way in.
  * **It does not rank by relevance.** It orders by whether the name STARTS
    with the query and then alphabetically, because a substring match on a
    3,000-row table has no signal worth modelling. `battles` is not used as a
    tiebreak: the loudest account is not the one you meant.
  * **It does not return anything but a tag and a name.** The caller navigates
    to the tag; everything else about the player is a screen away, and a
    search endpoint that ships stats is a second, worse copy of the player
    endpoint.

The query is a `LIKE` with a leading wildcard, which cannot use an index. That
is fine at this size — `player_names` has one row per tracked player, a few
thousand — and it is capped anyway. If the tracked population ever reaches the
tens of thousands this wants FTS, not a bigger LIMIT.
"""

from __future__ import annotations

import clash_data as cd

#: Most rows to return however many match. A search box showing more than a
#: handful is a list, and the person is meant to be picking, not reading.
MAX_RESULTS = 8

#: Shorter than this and every account matches. Two characters of a name is not
#: a search, it is a table scan with a UI on top.
MIN_QUERY = 2


def _escape(term: str) -> str:
    """`%` and `_` are wildcards in LIKE, and a name may contain either."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def search(query: str, limit: int = MAX_RESULTS) -> list[dict]:
    """Players whose stored name contains `query`. -> [{tag, name}].

    Never raises: this is a type-ahead, and a search that errors is worse than
    one that finds nothing. Empty list on a missing database, a short query, or
    a table this bot build does not have.
    """
    q = (query or "").strip()
    if len(q) < MIN_QUERY:
        return []

    path = cd.resolve_db_path()
    if not path:
        return []
    try:
        con = cd.connect(path)
    except Exception:
        return []

    like = "%" + _escape(q) + "%"
    starts = _escape(q) + "%"
    try:
        rows = con.execute(
            # The CASE is the whole ranking: a name that STARTS with what was
            # typed is what the person meant far more often than one that merely
            # contains it, and beyond that alphabetical is honest about having
            # no further opinion.
            "SELECT tag, name FROM player_names "
            "WHERE name LIKE ? ESCAPE '\\' AND name != '' "
            "ORDER BY CASE WHEN name LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, "
            "         name COLLATE NOCASE "
            "LIMIT ?",
            (like, starts, max(1, min(limit, MAX_RESULTS))),
        ).fetchall()
    except Exception:
        # An older bot database may predate `player_names` entirely.
        return []
    finally:
        con.close()

    out: list[dict] = []
    for r in rows:
        tag = cd.normalize_tag(r["tag"] or "")
        if tag:
            out.append({"tag": tag, "name": r["name"]})
    return out
