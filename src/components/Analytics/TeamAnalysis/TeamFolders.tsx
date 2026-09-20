import { useState } from 'react';
import type {
  RecommendationType,
  TeamChurn,
  TeamFolder,
  TeamMode,
  TeamOverall,
  TeamPlayerOptions,
  TeamRecommendation,
  TeamReport,
  TeamThreat,
} from '../../../state/analyticsClient';
import { CardArt } from '../CardArt';
import { DeckActions } from '../../DeckActions/DeckActions';
import { VsMark } from '../../VsMark/VsMark';
import styles from './TeamAnalysis.module.css';

/**
 * The folders under a team analysis: a gallery of opponents, and the opened
 * one.
 *
 * AN OPENED FOLDER IS A VERSUS BOARD — their decks left, yours right, the word
 * VS between. That is the same object the Duel Zone and Recent Battles already
 * draw, and it is the right one: the reader is comparing two sides, not reading
 * a list with an appendix. What differs is that the right-hand side is a
 * RECOMMENDATION rather than a record, so every row there has to carry who
 * plays it, what it is expected to do, and how much evidence that rests on —
 * otherwise it is a suggestion with the reasoning hidden.
 */

function pct(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : `${n.toFixed(1)}%`;
}

/** One deck, drawn the way every other deck on the site is drawn. */
function Strip({
  cards,
  art,
  inferred,
  name,
}: {
  cards: string[];
  art?: Record<string, 'evolution' | 'hero'>;
  inferred?: boolean;
  name?: string;
}) {
  return (
    <span className={styles.strip}>
      {cards.map((c, i) => (
        <CardArt key={`${c}-${i}`} card={c} variant={art?.[c]} inferred={inferred} />
      ))}
      {/* Renders nothing unless it is a whole 8-card deck — the guard that
          keeps these off partial lists everywhere else on the site. */}
      <DeckActions cards={cards} name={name} />
    </span>
  );
}

/**
 * SCOUT ONLY: the whole roster taken as one spread, above the folders.
 *
 * ── WHY THIS EXISTS, AND WHY THE MATCH PLAN HAS NO EQUIVALENT ─────────────
 *
 * A match plan assigns a person to each opponent, so its answer is necessarily
 * per opponent — a squad-wide "bring this" would be advice with nobody in a
 * position to take it. A scouting report has no roster to assign, and the
 * question people actually arrive with is usually the other one: *we play this
 * clan next week, what should we be practising.* That is a property of the
 * roster as a whole, and nothing further down the page answers it.
 *
 * IT SITS ABOVE THE FOLDERS, not below, because it is the coarser reading and
 * the folders are the detail under it. A reader who wants one deck to learn
 * stops here; a reader preparing player by player carries on.
 */
export function RosterRead({ overall }: { overall: TeamOverall }) {
  if (overall.reason === 'no_history') {
    return (
      <p className={styles.warn}>
        Nothing is stored for this roster in the window, so there is no combined spread to answer.
      </p>
    );
  }
  return (
    <section className={styles.roster}>
      <h3 className={styles.galleryTitle}>
        The roster as a whole
        <span className={styles.galleryCount}>{overall.players}</span>
      </h3>
      <p className={styles.rosterLede}>
        Every considered deck on the roster pooled into one spread, weighted by games rather than
        by player — so a roster&apos;s busiest member counts for more than its quietest, which is
        what actually decides what you will meet.
      </p>

      <div className={styles.rosterBody}>
        <ul className={styles.spread}>
          {overall.spread.map((s) => (
            <li key={s.archetype} className={styles.spreadRow}>
              <span>{s.name}</span>
              <span className={styles.spreadBar} aria-hidden="true">
                <span style={{ width: `${s.share}%` }} />
              </span>
              <span className={styles.spreadPct}>{s.share.toFixed(0)}%</span>
            </li>
          ))}
        </ul>

        {/* THE ROSTER'S POOLED PROJECTION, and it was missing here for one
            build. The opened folder had it and this block did not, which is
            the worse of the two places to leave it out: in a scouting report
            this is the first thing on the screen, and it was showing a
            portfolio with no statement of what the portfolio was chosen
            against. Same component, same labelling, one pooled distribution
            instead of one opponent's. */}
        <Threats threats={overall.threats ?? []} churn={overall.churn} />

        {overall.reason === 'no_evidence' ? (
          <p className={styles.warn}>
            No deck has a measured record against this roster&apos;s spread, so nothing is ranked.
          </p>
        ) : (
          <ol className={styles.mateDecks}>
            {overall.recommended.map((r, i) => (
              <Recommendation key={`${r.archetype}-${i}`} rec={r} rank={i + 1} />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

/** The gallery: one card per opponent, click to open. */
export function FolderGallery({
  report,
  onOpen,
}: {
  report: TeamReport;
  onOpen: (tag: string) => void;
}) {
  return (
    <>
      <h3 className={styles.galleryTitle}>
        {report.mode === 'scout' ? 'Player by player' : 'Opponents'}
        <span className={styles.galleryCount}>{report.folders.length}</span>
      </h3>

      <div className={styles.folderGrid}>
        {report.folders.map((f) => {
          const best = f.recommended[0];
          return (
            <button
              key={f.player.tag}
              type="button"
              className={styles.folder}
              onClick={() => onOpen(f.player.tag)}
            >
              <span className={styles.folderTab} aria-hidden="true" />
              <span className={styles.folderName}>{f.player.name}</span>
              {/* THE TAG LINE IS DROPPED WHEN IT IS THE NAME. `_resolve` falls
                  back to the tag when nothing knows a real one, and printing
                  both then renders "#2PP0PYLQ" twice under itself. */}
              {f.player.name !== f.player.tag && (
                <span className={styles.folderTag}>{f.player.tag}</span>
              )}

              {/* THE FACE OF THE FOLDER IS THE ANSWER, not a generic glyph.
                  What a coach is choosing between is "which opponent do I
                  still need a plan for", so the card shows whether there is
                  one and how good it is. */}
              {best ? (
                <>
                  <span className={styles.folderFaces} aria-hidden="true">
                    {best.cards.slice(0, 4).map((c, i) => (
                      <CardArt key={`${c}-${i}`} card={c} variant={best.art?.[c]} />
                    ))}
                  </span>
                  <span className={styles.folderLead}>
                    <strong>{pct(best.expectedWinRate)}</strong>{' '}
                    {best.owner ? (
                      <>
                        with {best.owner.name}&apos;s {best.name}
                      </>
                    ) : (
                      <>with {best.name}</>
                    )}
                  </span>
                  <span className={styles.folderMeta}>
                    {f.recommended.length} option{f.recommended.length === 1 ? '' : 's'} ·{' '}
                    {f.spread.length} archetype{f.spread.length === 1 ? '' : 's'} played
                  </span>
                </>
              ) : (
                <span className={styles.folderEmpty}>
                  {f.reason === 'no_history'
                    ? 'No stored history yet'
                    : 'Not enough evidence to rank a deck'}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

/** What a recommendation is FOR, in a coach's words rather than the enum's. */
const REC_TYPE_LABEL: Record<RecommendationType, string> = {
  COUNTER: 'Counter',
  ROBUST: 'Robust',
  CONTINGENCY: 'Contingency',
};

/** What each kind of projected threat is, said once, where it is drawn. */
const THREAT_LABEL: Record<string, string> = {
  OBSERVED: 'Seen playing',
  VARIANT: 'Close variant',
  INFERRED: 'Plausible',
};

/**
 * WHAT THEY ARE LIKELY TO BRING — the projection, beside the history.
 *
 * The list above this is `theirDecks`: decks they were actually observed
 * playing. This is the threat space the recommendations were scored against,
 * which is a different and larger thing — their decks, real variants of those
 * decks, and the archetypes their behaviour implies.
 *
 * THE TWO ARE DRAWN SEPARATELY AND LABELLED SEPARATELY, and that is the whole
 * honesty of the screen. A generated deck shown in the observed list would be
 * a claim that somebody watched them play it. Every row here says which kind
 * it is and how confident that is, and a variant names the deck it came from.
 */
function Threats({ threats, churn }: { threats: TeamThreat[]; churn?: TeamChurn }) {
  if (!threats.length) return null;
  return (
    <div className={styles.threats}>
      <h5 className={styles.threatsTitle}>
        Likely to bring
        {churn && (
          <span
            className={styles.threatsNote}
            title={
              churn.evidence === 'thin'
                ? 'Too little play to measure how much they switch, so the projection is deliberately wider than their history.'
                : churn.evidence === 'none'
                  ? 'No play at all to measure. The projection is as wide as it gets.'
                  : 'Measured from how their own play is spread across decks.'
            }
          >
            {churn.evidence === 'measured'
              ? `${Math.round(100 * churn.switch)}% chance of something off-book`
              : 'little history — projection widened'}
          </span>
        )}
      </h5>
      <ul className={styles.threatList}>
        {threats.map((t) => (
          <li key={t.key} className={styles.threatRow} data-evidence={t.evidence}>
            <span className={styles.threatLike}>{(100 * t.likelihood).toFixed(0)}%</span>
            <span className={styles.threatBody}>
              <span className={styles.threatName}>
                {t.name || t.archetype}
                <em className={styles.threatKind} data-evidence={t.evidence}>
                  {THREAT_LABEL[t.evidence] ?? t.evidence}
                </em>
              </span>
              {/* THE EVIDENCE, NEVER DRESSED UP. An observed deck quotes the
                  battles it was seen in; a variant names its parent and how
                  many cards it shares; an inferred entry says plainly that it
                  has never been seen. */}
              <span className={styles.threatWhy}>
                {t.evidence === 'OBSERVED'
                  ? `${t.observedCount} battle${t.observedCount === 1 ? '' : 's'} on record`
                  : t.evidence === 'VARIANT'
                    ? `${t.overlap ?? 0} of 8 cards shared with ${t.basisName || 'a deck they play'} — never seen from them`
                    : t.why === 'own_archetype'
                      ? 'An archetype they play, in a configuration not seen from them'
                      : 'Widely played, and nothing in their history rules it out'}
              </span>
            </span>
            <span className={styles.threatConf} data-conf={t.confidence}>
              {t.confidence}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One recommended deck, with the reasoning it was chosen on.
 *
 * IT RENDERS BOTH MODES, and the difference is what the second line can say.
 * A match plan's row is owned — somebody on the squad flies it, and how much
 * they have flown it is the tiebreak that ordered the list. A scouting
 * report's row is an archetype representative and belongs to nobody, so
 * instead of practice it quotes the deck's OWN record across the field: the
 * headline alone cannot separate "this beats them" from "this beats
 * everybody", and those are very different reasons to top a ranking.
 */
function Recommendation({ rec, rank }: { rec: TeamRecommendation; rank?: number }) {
  /* The delta is computed here rather than shipped, because the two halves are
     worth reading separately and a lone "+9.4" hides both of them. */
  const edge =
    rec.overallWinRate === null || rec.overallWinRate === undefined
      ? null
      : rec.expectedWinRate - rec.overallWinRate;

  return (
    <li className={styles.rec}>
      <div className={styles.recHead}>
        {rank !== undefined && <span className={styles.recRank}>{rank}</span>}
        <div className={styles.recWho}>
          <span className={styles.recDeck}>{rec.name}</span>
          {/* WHOSE DECK THIS IS is the load-bearing half of a match plan's
              recommendation: on the day, somebody has to pilot it. A scouting
              report has nobody, and says what the deck is instead of
              inventing an owner for it. */}
          <span className={styles.recOwner}>
            {rec.owner ? `${rec.owner.name} plays it` : 'Most-played list of this archetype'}
          </span>
        </div>
        <div className={styles.recFigures}>
          <span className={styles.recRate} title="Expected win rate against this opponent's spread of archetypes, weighted by how much they play each one.">
            {pct(rec.expectedWinRate)}
          </span>
          <span className={styles.recSub}>
            {rec.comfort ? (
              <>
                {rec.comfort.games} games piloted · {pct(rec.comfort.winRate)} with it
              </>
            ) : rec.overallWinRate !== null && rec.overallWinRate !== undefined ? (
              <span
                title="How this deck does against the whole field, for comparison. A deck that wins 58% here and 57% everywhere is barely a counter; the same 58% against a 49% baseline is a real answer."
              >
                {pct(rec.overallWinRate)} vs the field
                {edge !== null && (
                  <strong className={styles.recEdge} data-up={edge >= 0 || undefined}>
                    {' '}
                    {edge >= 0 ? '+' : ''}
                    {edge.toFixed(1)} here
                  </strong>
                )}
              </span>
            ) : (
              'No overall record to compare against'
            )}
          </span>
        </div>
      </div>

      <Strip
        cards={rec.cards}
        art={rec.art}
        name={rec.owner ? `${rec.owner.name} — ${rec.name}` : rec.name}
      />

      {/* WHY THIS DECK IS ON THE LIST, and how much is actually known.
          A portfolio of five to seven only reads as preparation if each row
          says what job it is doing; without this it reads as a longer ranking,
          which is the failure the longer list was supposed to fix. Both are
          optional — a server predating the brain sends neither, and the row
          then draws exactly as it always did. */}
      {(rec.type || rec.confidence) && (
        <p className={styles.recWhy}>
          {rec.type && (
            <span className={styles.recType} data-type={rec.type}>
              {REC_TYPE_LABEL[rec.type]}
            </span>
          )}
          {rec.confidence && (
            <span className={styles.recConf} data-conf={rec.confidence}>
              {rec.confidence}
            </span>
          )}
          {rec.explanation && <span className={styles.recSay}>{rec.explanation}</span>}
        </p>
      )}

      {/* HOW MUCH OF THEIR PLAY THIS COVERS. An expected rate computed over
          40% of what they bring is a different claim from one computed over
          all of it, and the difference is invisible in the headline. */}
      {rec.spreadCovered < 100 && (
        <p className={styles.recCover}>
          Measured against {pct(rec.spreadCovered)} of{' '}
          {rec.threatCovered !== undefined ? 'their likely pool' : 'what they play'} — the rest
          has no matchup evidence and was left out rather than counted as even.
        </p>
      )}

      {/* THE PER-THREAT BREAKDOWN IS GONE, and the projection above is why.
          It listed one row per threat — the threat's name, its share of the
          likely pool, this deck's rate against it and the rung that came from
          — which was the right shape when the opponent model was one row per
          ARCHETYPE. The projection is one row per DECK now, and
          `matchup_ladder` still answers per archetype, so four Mixed threats
          produced four rows carrying the identical `57.2% · 8,390 games`. The
          list restated the projection directly above it and then repeated
          itself inside that. The headline, the coverage note and the
          explanation carry the same claim once each; the evidence trail
          survives in `matchups` on the payload and in the PDF. */}
    </li>
  );
}

/** Why one teammate has nothing to bring, in their own words. */
const NO_OPTIONS: Record<string, string> = {
  no_history: 'Nothing stored for this player yet',
  no_comfort: 'No deck played often enough to count',
  no_evidence: 'No measured record against what they bring',
};

/**
 * ONE TEAMMATE, AND THEIR OWN TOP THREE against this opponent.
 *
 * A ROW PER PLAYER, COLLAPSED, ALL THE SAME HEIGHT. This is the shape a lineup
 * is chosen in: the reader is scanning their own squad to decide who takes this
 * match, so the thing that has to be comparable at a glance is the players, not
 * the decks. Uniform rows make that a scan; rows that grow to fit their content
 * make it a reading exercise, and a teammate with nothing to offer would
 * collapse to a sliver and read as less important rather than as unavailable.
 *
 * THE COLLAPSED ROW IS NOT EMPTY. It carries the headline figure and the deck
 * that produced it, so the list answers "who should take this one" before
 * anything is opened at all — the expansion is for *why*, not for *what*.
 */
function PlayerRow({ row, open, onToggle }: {
  row: TeamPlayerOptions;
  open: boolean;
  onToggle: () => void;
}) {
  const best = row.decks[0];
  const id = `team-opts-${row.owner.tag.replace(/[^A-Za-z0-9]/g, '')}`;

  return (
    <li className={styles.mate} data-open={open || undefined}>
      <button
        type="button"
        className={styles.mateHead}
        onClick={onToggle}
        disabled={!best}
        aria-expanded={open}
        aria-controls={id}
      >
        <span className={styles.mateChevron} aria-hidden="true">
          {best ? (open ? '▾' : '▸') : '·'}
        </span>

        <span className={styles.mateWho}>
          <span className={styles.mateName}>{row.owner.name}</span>
          <span className={styles.mateSub}>
            {best
              ? `${best.name}${row.considered > row.decks.length ? ` · ${row.considered} decks weighed` : ''}`
              : NO_OPTIONS[row.reason ?? ''] ?? 'No options'}
          </span>
        </span>

        {/* The figure sits on the collapsed row deliberately: it is what the
            reader is comparing teammates on. */}
        <span className={styles.mateFigure}>
          {best ? (
            <>
              <span className={styles.mateRate}>{pct(best.expectedWinRate)}</span>
              <span className={styles.mateCount}>
                {row.decks.length} deck{row.decks.length === 1 ? '' : 's'}
              </span>
            </>
          ) : (
            <span className={styles.mateNone}>—</span>
          )}
        </span>
      </button>

      {open && best && (
        <ol className={styles.mateDecks} id={id}>
          {row.decks.map((r, i) => (
            <Recommendation key={`${r.archetype}-${i}`} rec={r} rank={i + 1} />
          ))}
        </ol>
      )}
    </li>
  );
}

/**
 * The opened folder: what they play, and what to bring.
 *
 * THE LEFT HALF IS IDENTICAL IN BOTH MODES, because "what does this player
 * actually bring" is the same question and the same evidence whether or not a
 * squad was pasted. Only the right half changes: a match plan lists YOUR
 * PLAYERS, one row each, because somebody has to be assigned the match; a
 * scouting report has nobody to assign, so it lists the decks themselves,
 * ranked, and the reader is choosing something to go and practise.
 */
export function OpenFolder({
  folder,
  onBack,
  mode = 'squads',
}: {
  folder: TeamFolder;
  onBack: () => void;
  mode?: TeamMode;
}) {
  const p = folder.player;
  const scout = mode === 'scout';

  /* WHICH TEAMMATE IS OPEN, and only one at a time. Several open at once turns
     the uniform list back into a wall the reader has to scroll, which is the
     thing the collapsed rows exist to avoid. Keyed by tag rather than index so
     it survives the list changing. */
  const [openMate, setOpenMate] = useState<string | null>(null);
  return (
    <div className={styles.open}>
      <div className={styles.openHead}>
        <button type="button" className={styles.back} onClick={onBack}>
          ← All opponents
        </button>
        <div className={styles.openWho}>
          <h3 className={styles.openName}>{p.name}</h3>
          {p.name !== p.tag && <span className={styles.openTag}>{p.tag}</span>}
        </div>
        <span className={styles.openStat}>
          {p.basis === 'stored'
            ? `${p.battles.toLocaleString()} battles · ${pct(p.winRate)} win rate`
            : p.basis === 'live'
              ? `Live log only — ${p.battles} recent battles`
              : 'No history available'}
        </span>
      </div>

      {p.basis === 'live' && (
        <p className={styles.warn}>
          This player has never been tracked, so everything below rests on their last {p.battles}{' '}
          battles from the Clash Royale API. The tag is queued — come back once it has been
          collected for a fuller read.
        </p>
      )}

      {folder.reason ? (
        <p className={styles.warn}>
          {folder.reason === 'no_history'
            ? 'Nothing is stored for this player in the window, so there is no spread to answer.'
            : scout
              ? 'No deck has a measured record against what this player brings, so nothing is ranked. A recommendation here would be a guess wearing a percentage.'
              : 'None of your squad’s decks has a measured record against what this player brings, so nothing is ranked. A recommendation here would be a guess wearing a percentage.'}
        </p>
      ) : (
        <>
          {/* THE VERSUS BOARD. Their decks pushed left, yours right, VS between
              — the same object Recent Battles and the Duel Zone draw. */}
          <div className={styles.board}>
            <section className={styles.boardSide} data-side="red">
              <h4 className={styles.boardTitle}>They play</h4>
              <ul className={styles.theirs}>
                {folder.theirDecks.map((d) => (
                  <li key={d.deckHash} className={styles.their}>
                    <div className={styles.theirHead}>
                      <span className={styles.theirName}>{d.name}</span>
                      <span className={styles.theirStat}>
                        {d.useRate.toFixed(0)}% use · {pct(d.winRate)} · {d.matches} games
                      </span>
                    </div>
                    <Strip cards={d.cards} art={d.art} inferred={d.artInferred} name={d.name} />
                  </li>
                ))}
              </ul>

              <ul className={styles.spread}>
                {folder.spread.map((s) => (
                  <li key={s.archetype} className={styles.spreadRow}>
                    <span>{s.name}</span>
                    <span className={styles.spreadBar} aria-hidden="true">
                      <span style={{ width: `${s.share}%` }} />
                    </span>
                    <span className={styles.spreadPct}>{s.share.toFixed(0)}%</span>
                  </li>
                ))}
              </ul>

              {/* Below the history, because it is derived from it and a reader
                  should meet the evidence before the projection built on it. */}
              <Threats threats={folder.threats ?? []} churn={folder.churn} />
            </section>

            <div className={styles.boardVs}>
              <VsMark size="md" />
            </div>

            {scout ? (
              /* NO SQUAD, SO NO ASSIGNMENT — the answer is the decks
                 themselves, ranked, and they are expanded rather than
                 collapsed. The collapsed rows in the other mode exist so a
                 reader can compare PLAYERS at a glance; with nobody to
                 compare, hiding the reasoning behind a chevron would only put
                 a click in front of the one thing on the board. */
              <section className={styles.boardSide} data-side="blue">
                <h4 className={styles.boardTitle}>What beats it</h4>
                <ol className={styles.mateDecks}>
                  {folder.recommended.map((r, i) => (
                    <Recommendation key={`${r.archetype}-${i}`} rec={r} rank={i + 1} />
                  ))}
                </ol>
                <p className={styles.considered}>
                  Ranked from {folder.considered} archetype
                  {folder.considered === 1 ? '' : 's'}, each represented by its most-played real
                  list. Nothing here is generated — every deck is one people run, with a record
                  to score it on.
                </p>
              </section>
            ) : (
              /* YOUR SQUAD, ONE ROW EACH. Every teammate appears — including
                 one with nothing to bring, which is information rather than a
                 reason to omit them. */
              <section className={styles.boardSide} data-side="blue">
                <h4 className={styles.boardTitle}>Your players</h4>
                <ul className={styles.mates}>
                  {folder.perPlayer.map((row) => (
                    <PlayerRow
                      key={row.owner.tag}
                      row={row}
                      open={openMate === row.owner.tag}
                      onToggle={() =>
                        setOpenMate(openMate === row.owner.tag ? null : row.owner.tag)
                      }
                    />
                  ))}
                </ul>
                <p className={styles.considered}>
                  Tap a player for their best three against {p.name}. Ranked from{' '}
                  {folder.considered} deck{folder.considered === 1 ? '' : 's'} your squad actually
                  plays.
                </p>
              </section>
            )}
          </div>

        </>
      )}
    </div>
  );
}
