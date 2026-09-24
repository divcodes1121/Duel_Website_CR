import { useState } from 'react';

import type { DeckFamily, FieldPick, FieldPlan, LearnSuggestion } from '../../../state/analyticsClient';
import { CardArt } from '../../Analytics/CardArt';
import { DeckActions } from '../../DeckActions/DeckActions';
import { ChartCard, InsightRow } from '../../ui/bionis-dashboard';
import { TrendIcon } from '../../Dashboard/icons';
import styles from './CoachRoster.module.css';

/**
 * WHAT TO PLAY, AS THREE QUESTIONS INSTEAD OF ONE RANKING.
 *
 * ── WHY THE OLD SCREEN WAS REPLACED, MEASURED ──────────────────────────────
 *
 * It printed seven decks and they were nearly the same seven for everybody.
 * Measured on the six busiest real accounts: 42 slots drew on TEN distinct
 * decks, any two players shared four to six of seven, and THREE decks appeared
 * in every single plan. `tailoredPicks` — the engine's own count of how many
 * picks the personal weighting put there — was 0 for five of the six.
 *
 * That was not a scoring bug. `diversify()` is a PORTFOLIO picker whose
 * archetype-repeat penalty deliberately spreads picks across archetypes, which
 * collapses 204 decks to "the best deck of each of seven", i.e. a tier list —
 * and a tier list is the same for everyone by construction. Nothing in the
 * ranking knew what the player actually plays.
 *
 * The same six accounts after this change: 25 distinct decks, mean pairwise
 * overlap 1.00 decks, and NOTHING in every player's list.
 *
 * ── THE THREE BLOCKS, AND WHAT EACH ONE IS ALLOWED TO CLAIM ────────────────
 *
 *   CLOSEST         decks built from cards they already run. The claim is
 *                   "you could pilot this today", and it is checkable by
 *                   eye — the shared count is raw, off two card strips.
 *   WORTH LEARNING  one win condition outside their range whose best deck
 *                   beats everything inside it. The only block allowed to be
 *                   unfamiliar, and it states the margin that justifies it.
 *   FAMILIES        every win condition the field can be answered with,
 *                   browsable. The spread is STRUCTURAL here, which is what
 *                   `diversify` was being used to fake.
 */

function sharedLine(p: FieldPick, self = false): string | null {
  const a = p.affinity;
  if (!a || !a.familiar) return null;
  const n = a.deckBattles;
  const who = self ? 'you' : 'they';
  const line = `${a.shared} of ${a.of} cards are in a deck ${
    n === 1 ? `${who} played once` : `${who} have played ${n} times`
  }`;
  // A RESERVED ROW SAYS SO. It is in the family because it is close to what
  // they play, not because it out-ranked the others, and letting the reader
  // assume otherwise would be the screen overstating its own ranking.
  return p.closestOfFamily ? `Closest of this win condition · ${line}` : line;
}

function DeckRow({ p, note }: { p: FieldPick; note?: string | null }) {
  return (
    <li className={styles.deckItem}>
      <div className={styles.deckItemHead} style={{ cursor: 'default' }}>
        <div className={styles.deckCards}>
          {(p.cards ?? []).map((c) => (
            <CardArt key={c} card={c} variant={p.art?.[c]} inferred={p.artInferred} className={styles.deckCard} />
          ))}
        </div>
        <span className={styles.deckFigures}>
          <span className={styles.deckName}>{p.name}</span>
          <span>
            <strong>{p.expectedWinRate.toFixed(1)}%</strong> expected against the field
          </span>
          {note && <span className={styles.oppTag}>{note}</span>}
          <DeckActions cards={p.cards ?? []} name={p.name} />
        </span>
      </div>
    </li>
  );
}

/** Decks they could pick up today. */
export function ClosestCard({
  plan,
  self = false,
}: {
  plan: FieldPlan;
  self?: boolean;
}) {
  const near = plan.closest ?? [];
  const rep = plan.repertoire;
  const you = self ? 'you' : 'they';
  const your = self ? 'your' : 'their';

  return (
    <ChartCard
      title={self ? 'Closest to how you play' : 'Closest to how they play'}
      note={
        rep
          ? `Built from cards already in ${your} decks — ${rep.sharedFloor} of 8 or more, against the ${rep.decks} deck${rep.decks === 1 ? '' : 's'} ${you} played ${rep.deckFloor}+ times`
          : undefined
      }
      badge={near.length > 0 ? `${near.length} ranked` : 'Nothing yet'}
    >
      {near.length === 0 ? (
        <p className={styles.muted}>
          {/* THREE DIFFERENT REASONS FOR AN EMPTY LIST, and they are not
              interchangeable. One real account plays four decks heavily and
              none of the 204 that answer this field resembles them. */}
          {!rep || rep.decks === 0
            ? `No deck ${self ? 'you have' : 'they have'} played ${rep?.deckFloor ?? 5} or more times is stored for this window, so there is nothing to match against.`
            : `None of the decks that answer this field shares ${rep.sharedFloor} of its 8 cards with the ${rep.decks} deck${rep.decks === 1 ? '' : 's'} ${you} play. ${self ? 'Your' : 'Their'} decks sit outside what the field is currently answered with — which is what "Worth learning" is for.`}
        </p>
      ) : (
        <ul className={styles.deckList}>
          {near.map((p) => (
            <DeckRow key={p.key} p={p} note={sharedLine(p, self)} />
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

/** The one archetype worth the weeks it costs. */
export function LearnCard({
  learn,
  self = false,
}: {
  learn: LearnSuggestion | null | undefined;
  self?: boolean;
}) {
  const you = self ? 'You have' : 'They have';
  const your = self ? 'your' : 'their';
  return (
    <ChartCard
      title="Worth learning"
      note="A win condition outside their range that beats what is inside it"
      badge={learn ? learn.name : 'Nothing to add'}
    >
      {!learn ? (
        <p className={styles.muted}>
          {/* NULL IS A REAL ANSWER. A new archetype costs weeks, so it is only
              offered when it actually beats what they can already pilot. */}
          Nothing {self ? 'you have' : 'they have'} never played answers this field better than what {your} own
          decks already do. There is no archetype worth taking up right now.
        </p>
      ) : (
        <>
          <InsightRow
            icon={<TrendIcon />}
            tone="good"
            title={
              learn.beats != null
                ? `${learn.name} at ${learn.expectedWinRate.toFixed(1)}% — ${learn.beats.toFixed(1)} points better than anything ${self ? 'you' : 'they'} can already pilot`
                : `${learn.name} at ${learn.expectedWinRate.toFixed(1)}% against the field`
            }
            description={
              learn.yourBattles === 0
                ? `${you} never played it.`
                : `${you} played it ${learn.yourBattles} time${learn.yourBattles === 1 ? '' : 's'}${
                    learn.yourShare != null ? `, ${learn.yourShare}% of ${your} battles` : ''
                  }.`
            }
          />
          <ul className={styles.deckList}>
            <DeckRow p={learn.deck} />
          </ul>
        </>
      )}
    </ChartCard>
  );
}

/**
 * Every win condition the field can be answered with.
 *
 * ONE FAMILY OPEN AT A TIME, keyed by archetype — seventeen families of four
 * decks is sixty-eight card strips, and drawing them all at once buries the
 * two personal blocks above it.
 */
export function FamiliesCard({ plan, self = false }: { plan: FieldPlan; self?: boolean }) {
  const fams = plan.families ?? [];
  const [open, setOpen] = useState<string | null>(fams[0]?.archetype ?? null);
  if (fams.length === 0) return null;

  const mine = fams.filter((g) => g.yours);
  const rest = fams.filter((g) => !g.yours);

  const chips = (list: DeckFamily[]) => (
    <div className={styles.famRow}>
      {list.map((g: DeckFamily) => (
        <button
          key={g.archetype}
          type="button"
          className={styles.famChip}
          aria-pressed={open === g.archetype}
          onClick={() => setOpen(open === g.archetype ? null : g.archetype)}
        >
          {g.name} · {g.best.toFixed(1)}%
          {g.familiar > 0 && (
            <span className={styles.oppTag}> · {g.familiar} {self ? 'yours' : 'theirs'}</span>
          )}
        </button>
      ))}
    </div>
  );

  return (
    <ChartCard
      title="Every way to answer this field"
      note={
        mine.length > 0
          ? `${mine.length} win condition${mine.length === 1 ? '' : 's'} ${self ? 'you' : 'they'} can already play, then the rest of the field. Inside each, the field's own order decides.`
          : "Grouped by win condition, best first. Nothing here is built from cards they already play, so this is the field's order throughout."
      }
      badge={`${fams.length} win conditions`}
    >
      {/* TWO GROUPS, NOT ONE RANKING — and the split is a measured fact
          (is any deck of this win condition built from cards they play?)
          rather than a weight. Ordering by a bounded familiarity nudge was
          tried and measured: it moved 0 or 1 of 17 families on six live
          accounts, because the gaps between families are five points wide and
          the nudge is capped at 1.5. Grouping claims nothing about quality —
          inside each run the field's rate still decides. */}
      {mine.length > 0 && (
        <>
          <p className={styles.muted}>
            {self ? 'You can already play these' : 'They can already play these'}
          </p>
          {chips(mine)}
        </>
      )}
      {rest.length > 0 && (
        <>
          <p className={styles.muted}>
            {mine.length > 0 ? 'The rest of the field' : 'The field'}
          </p>
          {chips(rest)}
        </>
      )}
      {fams
        .filter((g) => g.archetype === open)
        .map((g) => (
          <div key={g.archetype}>
            <p className={styles.muted}>
              {g.total} {g.name} deck{g.total === 1 ? '' : 's'} in the pool
              {g.familiar > 0
                ? `, ${g.familiar} of which ${self ? 'you' : 'they'} could already pilot`
                : `, none of which matches a deck ${self ? 'you' : 'they'} play`}
              . Showing the best {g.decks.length}.
            </p>
            <ul className={styles.deckList}>
              {g.decks.map((p) => (
                <DeckRow key={p.key} p={p} note={sharedLine(p, self)} />
              ))}
            </ul>
          </div>
        ))}
    </ChartCard>
  );
}

export { DeckRow };
