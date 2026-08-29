import type {
  TeamFolder,
  TeamRecommendation,
  TeamReport,
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
        Opponents
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
                    <strong>{pct(best.expectedWinRate)}</strong> with {best.owner.name}&apos;s{' '}
                    {best.name}
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

/** One recommended deck, with the reasoning it was chosen on. */
function Recommendation({ rec, rank }: { rec: TeamRecommendation; rank?: number }) {
  return (
    <li className={styles.rec}>
      <div className={styles.recHead}>
        {rank !== undefined && <span className={styles.recRank}>{rank}</span>}
        <div className={styles.recWho}>
          <span className={styles.recDeck}>{rec.name}</span>
          {/* WHOSE DECK THIS IS is the load-bearing half of the
              recommendation: on the day, somebody has to pilot it. */}
          <span className={styles.recOwner}>{rec.owner.name} plays it</span>
        </div>
        <div className={styles.recFigures}>
          <span className={styles.recRate} title="Expected win rate against this opponent's spread of archetypes, weighted by how much they play each one.">
            {pct(rec.expectedWinRate)}
          </span>
          <span className={styles.recSub}>
            {rec.comfort.games} games piloted · {pct(rec.comfort.winRate)} with it
          </span>
        </div>
      </div>

      <Strip cards={rec.cards} art={rec.art} name={`${rec.owner.name} — ${rec.name}`} />

      {/* HOW MUCH OF THEIR PLAY THIS COVERS. An expected rate computed over
          40% of what they bring is a different claim from one computed over
          all of it, and the difference is invisible in the headline. */}
      {rec.spreadCovered < 100 && (
        <p className={styles.recCover}>
          Measured against {pct(rec.spreadCovered)} of what they play — the rest has no matchup
          evidence and was left out rather than counted as even.
        </p>
      )}

      <ul className={styles.recRows}>
        {rec.matchups.map((m) => (
          <li key={m.archetype} className={styles.recRow} data-unknown={m.winRate === null || undefined}>
            <span className={styles.recRowName}>{m.name}</span>
            <span className={styles.recRowShare}>{m.share.toFixed(0)}% of their play</span>
            <span className={styles.recRowRate}>
              {m.winRate === null ? 'no evidence' : pct(m.winRate)}
            </span>
            {/* The rung the number came from, never hidden — a figure off this
                exact deck and one off the archetype matrix are different
                claims wearing the same percentage. */}
            <span className={styles.recRowSrc} title={m.sourceText ?? undefined}>
              {m.winRate === null
                ? '—'
                : `${(m.games ?? 0).toLocaleString()} games${m.tier ? ` · ${m.tier}` : ''}`}
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

/** The opened folder: what they play, and what to bring. */
export function OpenFolder({ folder, onBack }: { folder: TeamFolder; onBack: () => void }) {
  const p = folder.player;
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
            </section>

            <div className={styles.boardVs}>
              <VsMark size="md" />
            </div>

            <section className={styles.boardSide} data-side="blue">
              <h4 className={styles.boardTitle}>You should bring</h4>
              <ol className={styles.recs}>
                {folder.recommended.map((r, i) => (
                  <Recommendation key={`${r.owner.tag}-${r.archetype}-${i}`} rec={r} rank={i + 1} />
                ))}
              </ol>
              <p className={styles.considered}>
                Ranked from {folder.considered} deck{folder.considered === 1 ? '' : 's'} your squad
                actually plays.
              </p>
            </section>
          </div>

          {/* A DIFFERENT QUESTION FROM THE TOP 3, and the one a lineup is built
              from: a team format assigns each player a match, so the three best
              decks all belonging to one teammate answers the wrong half. */}
          {folder.byPlayer.length > 1 && (
            <section className={styles.byPlayer}>
              <h4 className={styles.boardTitle}>Best option per teammate</h4>
              <ul className={styles.byPlayerList}>
                {folder.byPlayer.map((r) => (
                  <li key={r.owner.tag} className={styles.byPlayerRow}>
                    <span className={styles.byPlayerName}>{r.owner.name}</span>
                    <span className={styles.byPlayerDeck}>{r.name}</span>
                    <Strip cards={r.cards} art={r.art} name={`${r.owner.name} — ${r.name}`} />
                    <span className={styles.byPlayerRate}>{pct(r.expectedWinRate)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
