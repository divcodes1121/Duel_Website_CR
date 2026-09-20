import { useEffect, useMemo, useState } from 'react';

import { CARDS_BY_KEY } from '../../../data/cards';
import {
  ArsenalError,
  ROLE_TAGS,
  SOURCE_LABEL,
  averageElixir,
  deckLabel,
  filterArsenal,
  hasTag,
  reorderDecks,
  usedTags,
  type ArsenalDeck,
} from '../../../state/coachArsenal';
import { useCoachArsenal } from '../../../state/coachArsenalStore';
import { battleTimeToIso, playerLabel, type RosterPlayer } from '../../../state/coachRoster';
import type { CoachIntel } from '../../../state/analyticsClient';
import { ago } from '../../../utils/format';
import { CardArt } from '../../Analytics/CardArt';
import { DeckActions } from '../../DeckActions/DeckActions';
import { ReadingState } from '../../Analytics/ReadingState';
import { DeckEditorDialog } from './DeckEditorDialog';
import styles from './CoachRoster.module.css';

/**
 * THE DECK ARSENAL — the decks a coach considers this player ready to play.
 *
 * IT IS NOT THE HISTORY, AND THE SCREEN SAYS SO. The Decks-played tab already
 * lists every deck the player has actually run — often fifty, most of them
 * once. That is evidence about the past. An arsenal is a judgement about the
 * next match: a handful, ranked by the coach, each with what they call it, how
 * comfortable the player is on it, what it is for, and why. Nothing is copied
 * in automatically; a historical deck enters only by being CHOSEN, and its
 * source records that it came from one.
 *
 * WHAT EACH PIECE IS FOR, since four of them could be mistaken for decoration:
 *   • ORDER is the coach's ranking and nothing else — not comfort, not
 *     recency. It is what phases 4 and 5 will read as "try these in this
 *     order".
 *   • COMFORT is how well the player runs it, 1–5, and is deliberately
 *     separate from order: a deck can be their best answer to an opponent and
 *     still be the one they are shakiest on.
 *   • TAGS are free text on purpose (Primary, Anti-Beatdown, Needs practice…).
 *     A closed list would need a migration every time a coach thinks of one.
 *   • SOURCE is never inferred. Built by hand, pasted as a link, taken from
 *     their battles — later phases must be able to tell a coach's choice from
 *     an engine's suggestion, which is impossible after the fact.
 */

/* A MODULE CONSTANT, not `decks ?? []` inline: a fresh array every render sits
   in three useMemo dep lists and defeats all of them — the same default-value
   fault that once made a lazy Dashboard child hang for ever. */
const NO_DECKS: ArsenalDeck[] = [];

export function ArsenalTab({ player, intel }: { player: RosterPlayer; intel: CoachIntel | null }) {
  const decks = useCoachArsenal((s) => s.byPlayer[player.id]);
  const loading = useCoachArsenal((s) => s.loading[player.id]);
  const storeError = useCoachArsenal((s) => s.error);
  const repoKind = useCoachArsenal((s) => s.repoKind);
  const load = useCoachArsenal((s) => s.load);
  const update = useCoachArsenal((s) => s.update);
  const remove = useCoachArsenal((s) => s.remove);
  const reorder = useCoachArsenal((s) => s.reorder);

  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<ArsenalDeck | null>(null);
  const [adding, setAdding] = useState<null | { cards?: string[]; source: 'manual' | 'history'; ref?: unknown; name?: string }>(null);
  const [picking, setPicking] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load(player.id);
  }, [player.id, load]);

  const all = decks ?? NO_DECKS;
  const tags = useMemo(() => usedTags(all), [all]);
  const activeCount = all.filter((d) => d.status === 'active').length;
  const archivedCount = all.length - activeCount;

  /* DERIVED, not just the toggle's state. Restoring the last archived deck
     empties the archived view AND removes the button that switches back —
     which left the reader staring at nothing with no way out but the tab
     bar. Falling back the moment the archive is empty is the fix. */
  const viewingArchived = showArchived && archivedCount > 0;

  const visible = useMemo(() => {
    const byStatus = all.filter((d) => (viewingArchived ? d.status === 'archived' : d.status === 'active'));
    return filterArsenal(byStatus, query, tagFilter);
  }, [all, viewingArchived, query, tagFilter]);

  /* Decks they have actually played that are NOT already in the arsenal —
     the only list worth offering, since the rest would be refused as
     duplicates by the table anyway. */
  const fromHistory = useMemo(() => {
    if (!intel) return [];
    const held = new Set(all.map((d) => d.deckKey));
    return intel.decks.filter((d) => !held.has([...d.cards].sort().join(',')));
  }, [intel, all]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ArsenalError ? e.message : 'Could not save that change.');
    }
  }

  if (decks === undefined && loading) {
    return (
      <ReadingState k="coach-arsenal" hue="violet">
        Reading {playerLabel(player)}’s arsenal…
      </ReadingState>
    );
  }

  return (
    <div className={styles.arsenal}>
      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h3 className={styles.blockTitle}>Deck arsenal</h3>
          <span className={styles.muted}>
            {activeCount} deck{activeCount === 1 ? '' : 's'} they are ready to play
            {archivedCount > 0 ? ` · ${archivedCount} archived` : ''}
          </span>
        </div>

        <p className={styles.muted}>
          The decks you have approved for {playerLabel(player)} — not everything they have played. The Decks-played tab
          is the history; this is what they take into a match.
        </p>

        {repoKind === 'memory' && (
          <p className={styles.hint}>
            Local preview: Supabase is not configured in this checkout, so this arsenal lives in memory and is gone on
            reload.
          </p>
        )}

        <div className={styles.controlRow}>
          <button type="button" className={styles.primaryButton} onClick={() => setAdding({ source: 'manual' })}>
            + Build a deck
          </button>
          <button
            type="button"
            className={styles.ghostButton}
            disabled={!fromHistory.length}
            title={
              intel
                ? fromHistory.length
                  ? 'Choose from decks they have actually played'
                  : 'Every deck from their stored battles is already here'
                : 'Their battles have not been read yet'
            }
            onClick={() => setPicking(true)}
          >
            From their battles{fromHistory.length ? ` (${fromHistory.length})` : ''}
          </button>
          {archivedCount > 0 && (
            <button type="button" className={styles.ghostButton} onClick={() => setShowArchived((v) => !v)}>
              {viewingArchived ? `Show the arsenal (${activeCount})` : `Show archived (${archivedCount})`}
            </button>
          )}
        </div>

        {all.length > 0 && (
          <div className={styles.filterRow}>
            <input
              className={styles.input}
              value={query}
              placeholder="Find a deck by name, archetype or card"
              aria-label="Find a deck"
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className={styles.tagRow}>
              {tags.map((t) => {
                const on = tagFilter.some((x) => x.toLowerCase() === t.toLowerCase());
                return (
                  <button
                    key={t}
                    type="button"
                    className={styles.tagChip}
                    data-on={on || undefined}
                    aria-pressed={on}
                    onClick={() =>
                      setTagFilter((f) => (on ? f.filter((x) => x.toLowerCase() !== t.toLowerCase()) : [...f, t]))
                    }
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {(error || storeError) && <p className={styles.formError}>{error ?? storeError}</p>}
      </section>

      {visible.length === 0 ? (
        <section className={styles.notice}>
          <h3>{all.length === 0 ? 'No decks in the arsenal yet' : 'Nothing matches that'}</h3>
          <p>
            {all.length === 0
              ? 'Build one card by card, paste a Clash Royale deck link, or take one from the decks they have actually played.'
              : 'Clear the search or the tag filters to see the rest.'}
          </p>
        </section>
      ) : (
        <ul className={styles.arsenalList}>
          {visible.map((d, i) => (
            <ArsenalRow
              key={d.id}
              deck={d}
              index={i}
              count={visible.length}
              reorderable={!viewingArchived && !query && tagFilter.length === 0}
              onMove={(dir) => void run(() => reorder(player.id, reorderDecks(all.filter((x) => x.status === 'active'), d.id, dir)))}
              onEdit={() => setEditing(d)}
              onToggleRole={(tag) =>
                void run(() =>
                  update(player.id, d.id, {
                    tags: hasTag(d, tag)
                      ? d.tags.filter((t) => t.toLowerCase() !== tag.toLowerCase())
                      : [...d.tags, tag],
                  }),
                )
              }
              onArchive={() =>
                void run(() => update(player.id, d.id, { status: d.status === 'active' ? 'archived' : 'active' }))
              }
              confirming={confirm === d.id}
              onAskRemove={() => setConfirm(d.id)}
              onCancelRemove={() => setConfirm(null)}
              onRemove={() =>
                void run(async () => {
                  await remove(player.id, d.id);
                  setConfirm(null);
                })
              }
            />
          ))}
        </ul>
      )}

      {(adding || editing) && (
        <DeckEditorDialog
          playerId={player.id}
          deck={editing ?? undefined}
          initialCards={adding?.cards}
          initialSource={adding?.source ?? 'manual'}
          initialSourceRef={adding?.ref ?? null}
          initialName={adding?.name}
          onClose={() => {
            setAdding(null);
            setEditing(null);
          }}
        />
      )}

      {picking && intel && (
        <HistoryPicker
          decks={fromHistory}
          total={intel.decksTotal}
          onClose={() => setPicking(false)}
          onPick={(d) => {
            setPicking(false);
            setAdding({
              cards: d.cards,
              source: 'history',
              name: d.deckName,
              // What it was taken from, so a later phase can say "this is the
              // deck they ran 42 times in September" without re-deriving it.
              ref: { kind: 'intel_deck', battles: d.battles, wins: d.wins, losses: d.losses, last: d.last, window: intel.window },
            });
          }}
        />
      )}
    </div>
  );
}

function ArsenalRow({
  deck,
  index,
  count,
  reorderable,
  onMove,
  onEdit,
  onToggleRole,
  onArchive,
  confirming,
  onAskRemove,
  onCancelRemove,
  onRemove,
}: {
  deck: ArsenalDeck;
  index: number;
  count: number;
  reorderable: boolean;
  onMove: (dir: -1 | 1) => void;
  onEdit: () => void;
  onToggleRole: (tag: string) => void;
  onArchive: () => void;
  confirming: boolean;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const elixir = averageElixir(deck.cards);
  const label = deckLabel(deck);

  return (
    <li className={styles.arsenalItem} data-archived={deck.status === 'archived' || undefined}>
      <div className={styles.arsenalHead}>
        {reorderable && (
          <div className={styles.rankCol}>
            <button
              type="button"
              className={styles.rankButton}
              disabled={index === 0}
              aria-label={`Move ${label} up`}
              onClick={() => onMove(-1)}
            >
              ↑
            </button>
            <span className={styles.rankNumber}>{index + 1}</span>
            <button
              type="button"
              className={styles.rankButton}
              disabled={index === count - 1}
              aria-label={`Move ${label} down`}
              onClick={() => onMove(1)}
            >
              ↓
            </button>
          </div>
        )}

        <div className={styles.deckCards}>
          {deck.cards.map((c) => (
            <CardArt key={c} card={c} className={styles.deckCard} />
          ))}
        </div>

        <div className={styles.arsenalMeta}>
          <button type="button" className={styles.deckNameButton} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {label}
          </button>
          <span className={styles.muted}>
            {deck.archetype ? `${deck.archetype} · ` : ''}
            {elixir !== null ? `${elixir.toFixed(1)} elixir` : 'elixir unknown'} · {SOURCE_LABEL[deck.source]}
          </span>
          <span className={styles.stars} aria-label={deck.comfort ? `Comfort ${deck.comfort} of 5` : 'Comfort not rated'}>
            {deck.comfort === null ? (
              <span className={styles.muted}>comfort not rated</span>
            ) : (
              <span className={styles.starsStatic} aria-hidden>
                {'★'.repeat(deck.comfort)}
                {'☆'.repeat(5 - deck.comfort)}
              </span>
            )}
          </span>
          {deck.tags.length > 0 && (
            <span className={styles.tagRow}>
              {deck.tags.map((t) => (
                <span key={t} className={styles.tagChip} data-role={ROLE_TAGS.some((r) => r.toLowerCase() === t.toLowerCase()) || undefined}>
                  {t}
                </span>
              ))}
            </span>
          )}
        </div>
      </div>

      {open && (
        <div className={styles.arsenalDetail}>
          {deck.notes ? <p className={styles.notes}>{deck.notes}</p> : <p className={styles.muted}>No notes on this deck.</p>}
          <p className={styles.muted}>
            Cards: {deck.cards.map((c) => CARDS_BY_KEY.get(c)?.name ?? c).join(', ')}
          </p>
          {sourceLine(deck) && <p className={styles.muted}>{sourceLine(deck)}</p>}
          <div className={styles.controlRow}>
            <DeckActions cards={deck.cards} name={label} />
            {ROLE_TAGS.map((t) => (
              <button key={t} type="button" className={styles.ghostButton} onClick={() => onToggleRole(t)}>
                {hasTag(deck, t) ? `Remove ${t}` : `Mark ${t}`}
              </button>
            ))}
            <button type="button" className={styles.ghostButton} onClick={onEdit}>
              Edit
            </button>
            {/* "deck" is in the label because the player's own controls at
                the top of this screen carry Archive and Remove too, and a
                reader — or a screen reader — cannot tell two identically
                named buttons apart. */}
            <button type="button" className={styles.ghostButton} onClick={onArchive}>
              {deck.status === 'active' ? 'Archive deck' : 'Restore deck'}
            </button>
            {!confirming ? (
              <button type="button" className={styles.dangerGhost} onClick={onAskRemove}>
                Remove deck…
              </button>
            ) : (
              <>
                <button type="button" className={styles.dangerButton} onClick={onRemove}>
                  Confirm remove deck
                </button>
                <button type="button" className={styles.ghostButton} onClick={onCancelRemove}>
                  Keep
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/** What a history-sourced deck was taken from, when the snapshot says so.
 *  Never guessed: a deck with no stored reference simply says nothing. */
function sourceLine(deck: ArsenalDeck): string | null {
  const ref = deck.sourceRef as { kind?: string; battles?: number; wins?: number; last?: string } | null;
  if (!ref || ref.kind !== 'intel_deck' || typeof ref.battles !== 'number') return null;
  const last = ref.last ? battleTimeToIso(ref.last) : null;
  const rate = typeof ref.wins === 'number' && ref.battles > 0 ? ` · ${((ref.wins / ref.battles) * 100).toFixed(0)}% won` : '';
  return `Taken from their battles: ${ref.battles} played${rate}${last ? ` · last ${ago(last)}` : ''}.`;
}

/** Pick one of the decks they have actually played. It shows the record, so
 *  the choice is made against evidence rather than against a card strip. */
function HistoryPicker({
  decks,
  total,
  onClose,
  onPick,
}: {
  decks: CoachIntel['decks'];
  total: number;
  onClose: () => void;
  onPick: (d: CoachIntel['decks'][number]) => void;
}) {
  return (
    <div className={styles.scrim} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`${styles.dialog} ${styles.pickerDialog}`} role="dialog" aria-modal="true" aria-label="Decks they have played">
        <h2 className={styles.dialogTitle}>Take a deck from their battles</h2>
        <p className={styles.muted}>
          {decks.length} of their {total} stored deck{total === 1 ? '' : 's'} are not in the arsenal yet. Picking one
          opens the editor, so you can name it and rate it before it is added — nothing is copied in unreviewed.
        </p>
        <ul className={styles.historyList}>
          {decks.map((d) => (
            <li key={d.key}>
              <button type="button" className={styles.historyPick} onClick={() => onPick(d)}>
                <span className={styles.deckCards}>
                  {d.cards.map((c) => (
                    <CardArt key={c} card={c} variant={d.art?.[c]} inferred={d.artInferred} className={styles.deckCard} />
                  ))}
                </span>
                <span className={styles.arsenalMeta}>
                  <span className={styles.deckName}>{d.deckName}</span>
                  <span className={styles.muted}>
                    {d.battles} battles · {((d.wins / d.battles) * 100).toFixed(0)}% won · avg {d.avgElixir?.toFixed(1) ?? '—'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className={styles.dialogActions}>
          <button type="button" className={styles.ghostButton} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
