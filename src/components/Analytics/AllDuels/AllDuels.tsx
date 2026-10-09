import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CardArt } from '../CardArt';
import { ReadingState } from '../ReadingState';
import { DeckActions } from '../../DeckActions/DeckActions';
import { CrownIcon, DropIcon, ListIcon } from '../../Dashboard/icons';
import { VsMark } from '../../VsMark/VsMark';
import { WinConFilter } from '../../WinConFilter/WinConFilter';
import { ContinuousPagination } from '../../ui/continuous-pagination';
import { Dropdown } from '../../ui/dropdown-menu-14';
import {
  AnalyticsError,
  fetchDuelFeed,
  type DuelFeedDeck,
  type DuelFeedDuel,
  type DuelFeedGame,
  type DuelFeedPlayer,
  type DuelFeedReport,
} from '../../../state/analyticsClient';
import { coachToken } from '../../../state/coachToken';
import { SWAPPED_NOTE, buildDuelImport, duelPairs } from '../../../state/duelImport';
import { useSavedSetLimit } from '../../../state/gate';
import { savedSetsFull } from '../../../state/tiers';
import { useBuilderStore } from '../../../state/store';
import {
  DUEL_FEED_DAY_PRESETS,
  DUEL_FEED_DEFAULT_DAYS,
  dayChip,
  dayLabel,
} from '../../../utils/datePresets';
import {
  DUEL_FEED_DEFAULT_PER_PAGE,
  DUEL_FEED_MAX_CARDS,
  DUEL_FEED_PER_PAGE,
  deckHolds,
  duelAsPlayed,
  duelFeedProblem,
  duelStamp,
  feedCount,
  pageRange,
  playerLabel,
  shownTag,
  windowDay,
} from '../../../utils/duelFeed';
import { initialsOf } from '../../../utils/initials';
import { revealListTop } from '../../../utils/revealListTop';
import styles from './AllDuels.module.css';

/**
 * All Duels — friendly duels that went to three games, newest first. ADMIN
 * ONLY.
 *
 * WHICH DUELS IS THE SERVER'S RULE, NOT THIS FILE'S. The first build listed
 * every native duel and nineteen in twenty were war duels; the account holder
 * looked at it and asked for friendly ones only, and only those where all
 * three games were played. So a row has no mode label — they are all the same
 * kind — and the line under the title says what kind.
 *
 * ONE CARD A DUEL, AND A DUEL IS READ ACROSS. Two players, so two columns: who
 * they are and the score in games at the top, then one line a game with each
 * player's eight cards at their own edge and that game's crowns between them.
 * A reader follows one player down the left edge or the other down the right,
 * and compares a game by reading across it.
 *
 * COLOUR SAYS WHO, NEVER WHO WON — the battle log's rule. The left player is
 * blue and the right one red all the way down their column. Winning is said
 * in green and in one place per level: the Winner mark beside a name, and the
 * filled crown pill of whoever took a game.
 *
 * THE LEFT SIDE IS NOBODY IN PARTICULAR. The duel index stores a duel from its
 * lexically first tag, so the same duel always draws the same way round; it is
 * not "the tracked player" or "the winner". That is why the winner is marked
 * rather than left to position.
 *
 * FILTERING MARKS THE DECK THAT MATCHED. A duel is on a filtered page because
 * one of its decks runs every picked card; that deck takes a ring, so the
 * reason the duel is there does not have to be found among six strips.
 *
 * Every figure is the server's (`server/duel_feed.py`). This draws.
 */

type Side = 'a' | 'b';

function Player({ player, side, won }: { player: DuelFeedPlayer; side: Side; won: boolean }) {
  const label = playerLabel(player);
  const tag = shownTag(player.tag);
  return (
    <div className={styles.player} data-side={side}>
      <span className={styles.avatar} aria-hidden="true">
        {initialsOf(label)}
      </span>
      <span className={styles.who}>
        <span className={styles.name} title={label}>
          {label}
        </span>
        {/* THE WINNER MARK SHARES THE TAG'S LINE, NOT THE NAME'S. Beside the
            name it took 60px out of the one line that cannot spare it: on a
            phone the winner's name was cut to three letters while the loser's
            was whole.

            The tag is what gets copied to look somebody up. When no name was
            ever stored the tag is already the label, and is not printed twice. */}
        {((player.name && tag) || won) && (
          <span className={styles.meta}>
            {player.name && tag && <span className={styles.tag}>{tag}</span>}
            {won && <span className={styles.winner}>Winner</span>}
          </span>
        )}
      </span>
    </div>
  );
}

function DeckStrip({ deck, side, match }: { deck: DuelFeedDeck; side: Side; match: boolean }) {
  return (
    <div className={styles.deck} data-side={side} data-match={match || undefined}>
      <div className={styles.deckHead}>
        <span className={styles.deckName} title={deck.deckName}>
          {deck.deckName}
        </span>
        <span className={styles.elixir} title="Average elixir">
          <DropIcon size={12} />
          {deck.avgElixir.toFixed(1)}
        </span>
        {/* Server order, untouched: the deck is already seated, so the game is
            handed the evolution and hero slots exactly as they are drawn. */}
        <DeckActions
          cards={deck.cards}
          name={deck.deckName}
          size="sm"
          art={deck.art}
          className={styles.deckActions}
        />
      </div>
      <div className={styles.cards}>
        {deck.cards.map((c) => (
          <CardArt
            key={c}
            card={c}
            variant={deck.art?.[c]}
            inferred={deck.artInferred}
            className={styles.card}
          />
        ))}
      </div>
    </div>
  );
}

function Crowns({ n, side, won, who }: { n: number; side: Side; won: boolean; who: string }) {
  return (
    <span
      className={styles.crowns}
      data-side={side}
      data-won={won || undefined}
      aria-label={`${who}: ${n} crown${n === 1 ? '' : 's'}${won ? ', won the game' : ''}`}
    >
      <CrownIcon size={13} />
      {n}
    </span>
  );
}

function GameRow({
  game,
  duel,
  picked,
}: {
  game: DuelFeedGame;
  duel: DuelFeedDuel;
  picked: readonly string[];
}) {
  return (
    <li className={styles.game}>
      <DeckStrip deck={game.a} side="a" match={deckHolds(game.a.cards, picked)} />
      <div className={styles.gameMid}>
        <span className={styles.gameNo}>Game {game.game}</span>
        <span className={styles.gameScore}>
          <Crowns n={game.a.crowns} side="a" won={game.winner === 'a'} who={playerLabel(duel.a)} />
          <VsMark size="xs" />
          <Crowns n={game.b.crowns} side="b" won={game.winner === 'b'} who={playerLabel(duel.b)} />
        </span>
      </div>
      <DeckStrip deck={game.b} side="b" match={deckHolds(game.b.cards, picked)} />
    </li>
  );
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M17 21v-8H7v8M7 3v5h8" />
    </svg>
  );
}

/* SAVE THIS DUEL INTO THE BUILDER — the Duel Zone's Save duel, on this list.
 *
 * A duel already is a Versus set: one player's three decks against another's.
 * The button hands it to the same store action the Duel Zone uses
 * (`saveDuelPlayed`), so it lands in Royal Duels' saved groups as "Duel Deck
 * n" — the left player's decks as Blue, the right player's as Red, in game
 * order, with their forms and crowns — and syncs like any other saved set.
 *
 * WHETHER IT IS SAVED IS READ FROM THE LIBRARY, NOT REMEMBERED HERE. A flag in
 * this component would forget on the next page turn, and the row would offer
 * to save a duel that is already in the builder. Asking the library — the same
 * duplicate rule the save itself applies — means a duel saved yesterday says
 * so today, and one deleted from the builder can be saved again. That rule
 * matches the decks either way round, so a duel saved from the right-hand
 * player's Duel Zone (their decks as Blue there) says so here too.
 *
 * It is disabled unless EVERY game can be built. The save skips a game holding
 * a card this build of the site does not know yet, and on a list whose whole
 * point is that all three games were played, two-thirds of a duel is not it. */
function SaveDuel({ duel }: { duel: DuelFeedDuel }) {
  const library = useBuilderStore((s) => s.library);
  const saveDuelPlayed = useBuilderStore((s) => s.saveDuelPlayed);
  const games = useMemo(() => duelAsPlayed(duel), [duel]);
  const whole = useMemo(() => duelPairs(games).length === duel.games.length, [games, duel]);
  const limit = useSavedSetLimit();
  const outcome = useMemo(
    () => buildDuelImport(games, library, limit).outcome,
    [games, library, limit],
  );
  const saved = !outcome.ok && outcome.reason === 'duplicate' ? outcome : null;
  const full = !outcome.ok && outcome.reason === 'full';

  if (saved) {
    return (
      <span
        className={styles.savedNote}
        role="status"
        title={saved.swapped ? SWAPPED_NOTE : undefined}
      >
        Saved as {saved.name}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={styles.saveBtn}
      disabled={!whole || full}
      onClick={() => saveDuelPlayed(games, limit)}
      title={
        full
          ? savedSetsFull(limit)
          : whole
            ? `Save to Royal Duels as a Versus set: ${duel.games.length} decks each side`
            : 'A deck in this duel holds a card this version of the site does not know yet'
      }
    >
      <SaveIcon />
      Save duel
    </button>
  );
}

function DuelCard({ duel, picked }: { duel: DuelFeedDuel; picked: readonly string[] }) {
  return (
    <article className={styles.duel} data-duel-id={duel.id}>
      <header className={styles.duelHead}>
        <time className={styles.when}>{duelStamp(duel.battleTime)}</time>
        <SaveDuel duel={duel} />
      </header>

      <div className={styles.players}>
        <Player player={duel.a} side="a" won={duel.winner === 'a'} />
        <span
          className={styles.score}
          aria-label={`${playerLabel(duel.a)} ${duel.a.wins}, ${playerLabel(duel.b)} ${duel.b.wins}, in games`}
        >
          <span className={styles.scoreNum} data-won={duel.winner === 'a' || undefined}>
            {duel.a.wins}
          </span>
          <span className={styles.scoreDash}>–</span>
          <span className={styles.scoreNum} data-won={duel.winner === 'b' || undefined}>
            {duel.b.wins}
          </span>
        </span>
        <Player player={duel.b} side="b" won={duel.winner === 'b'} />
      </div>

      <ol className={styles.games}>
        {duel.games.map((g) => (
          <GameRow key={g.game} game={g} duel={duel} picked={picked} />
        ))}
      </ol>
    </article>
  );
}

export function AllDuels() {
  const [report, setReport] = useState<DuelFeedReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<number>(DUEL_FEED_DEFAULT_DAYS);
  const [per, setPer] = useState<number>(DUEL_FEED_DEFAULT_PER_PAGE);
  /* What the reader picked. The server decides which of them it accepted, so
     the count line and the deck marks read `report.cards`, never this. */
  const [picked, setPicked] = useState<string[]>([]);
  /* The page ASKED FOR, set on the click so the pager's slab moves at once.
     The server clamps a page past the end, and its answer replaces this. */
  const [page, setPage] = useState(1);
  const listRef = useRef<HTMLDivElement>(null);
  /* Only the newest request may write: pages can be clicked faster than they
     arrive, and an older answer must not land on top of a newer one. */
  const seq = useRef(0);

  const load = useCallback(async (p: number, cards: string[], d: number, n: number) => {
    const id = ++seq.current;
    setPage(p);
    setLoading(true);
    setError(null);
    try {
      const token = await coachToken();
      const r = await fetchDuelFeed(d, cards, p, n, token);
      if (id !== seq.current) return;
      setReport(r);
      setPage(r.page);
    } catch (e) {
      if (id !== seq.current) return;
      const err = e as AnalyticsError;
      setError(duelFeedProblem(err?.kind ?? 'server', err?.message ?? ''));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(1, [], DUEL_FEED_DEFAULT_DAYS, DUEL_FEED_DEFAULT_PER_PAGE);
  }, [load]);

  /* Every control asks a new question about the whole window, so each one
     goes back to page 1: staying on page 900 of a list that now has four
     pages would clamp to the end and read as a jump to nowhere. */
  function toggle(key: string) {
    const next = picked.includes(key)
      ? picked.filter((k) => k !== key)
      : picked.length >= DUEL_FEED_MAX_CARDS
        ? picked
        : [...picked, key];
    if (next === picked) return;
    setPicked(next);
    void load(1, next, days, per);
  }

  function clear() {
    setPicked([]);
    void load(1, [], days, per);
  }

  const accepted = report?.cards ?? [];

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.title}>All Duels</h1>
          {report?.available && (
            <p className={styles.count} data-count>
              {feedCount(report)}
              {report.window.from && report.window.to && (
                <>
                  {' · '}
                  {windowDay(report.window.from)} – {windowDay(report.window.to)}
                </>
              )}
              {/* The first ask of a card filter reads the whole window, which
                  can take a few seconds; the dimmed list alone does not say
                  whether anything is happening. */}
              {loading && (
                <span className={styles.busy} role="status">
                  Reading…
                </span>
              )}
            </p>
          )}
        </div>

        {/* THREE WINDOWS AND NOTHING ELSE, by request. A group of toggle
            buttons rather than a dropdown: three choices fit, and the one in
            force stays on screen. */}
        <div className={styles.range} role="group" aria-label="Time window">
          {DUEL_FEED_DAY_PRESETS.map((d) => (
            <button
              key={d}
              type="button"
              className={styles.rangeChip}
              aria-pressed={days === d}
              title={dayLabel(d)}
              onClick={() => {
                if (d === days) return;
                setDays(d);
                void load(1, picked, d, per);
              }}
            >
              {dayChip(d)}
            </button>
          ))}
        </div>
      </header>

      <div className={styles.controls}>
        {/* `start`: this trigger leads its row at the left margin, so the 30rem
            panel has to grow rightwards into the page. */}
        <WinConFilter
          selected={picked}
          onToggle={toggle}
          onClear={clear}
          align="start"
          title="Show only duels where one deck holds these cards"
        />
        <Dropdown
          size="sm"
          caption="Per page"
          icon={<ListIcon />}
          heading="Duels per page"
          value={String(per)}
          onChange={(v) => {
            const n = Number(v);
            setPer(n);
            void load(1, picked, days, n);
          }}
          options={DUEL_FEED_PER_PAGE.map((n) => ({ value: String(n), label: `${n} duels` }))}
        />
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {/* THE FIRST READ ONLY. A page turn, a pick or a new window dims the
          list in place instead — replacing it with a loader would unmount the
          pager under the pointer that just pressed it. */}
      {loading && !report && !error && (
        <ReadingState k="all-duels" hue="blue">
          Reading the duels…
        </ReadingState>
      )}

      {report && !report.available && !error && (
        <p className={styles.empty}>The duel index has not been built on this server yet.</p>
      )}

      {report?.available && (
        <>
          <div ref={listRef} className={styles.list} data-busy={loading || undefined}>
            {report.duels.map((d) => (
              <DuelCard key={d.id} duel={d} picked={accepted} />
            ))}
            {!report.duels.length && (
              <p className={styles.empty}>
                {accepted.length
                  ? 'No duel in this window has a deck running all of those cards.'
                  : 'No duels stored in this window.'}
              </p>
            )}
          </div>

          <footer className={styles.foot}>
            {report.pages > 1 && (
              <ContinuousPagination
                className={styles.pager}
                totalPages={report.pages}
                page={Math.min(page, report.pages)}
                onPageChange={(p) => {
                  void load(p, picked, days, per);
                  revealListTop(listRef.current);
                }}
                label="Duel pages"
              />
            )}
            <span className={styles.pageCount}>{pageRange(report)}</span>
          </footer>
        </>
      )}
    </div>
  );
}

export default AllDuels;
