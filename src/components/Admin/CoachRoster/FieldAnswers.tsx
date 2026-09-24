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

/** How old this answer is, and what it was computed over.
 *
 * THE BOARD IS NOT A FIXED LIST AND THE SCREEN HAS TO SAY SO. The pool is
 * rebuilt from a rolling window of real battles on an hourly timer, and the
 * player's own side is a rolling 30 days, so these decks move as the meta and
 * their usage move. Without a date on it a coach who opens the tab twice in a
 * week cannot tell a board that has not changed from a board that is stuck —
 * and the honest answer to "is this stale?" is a timestamp, not a reassurance.
 *
 * `trend` is the other half: once `meta_history` holds enough days, the
 * projection is weighted toward what the field is TAKING UP rather than what
 * it played. Under the floor it says so plainly instead of implying it is on.
 */
export function FreshnessLine({ plan }: { plan: FieldPlan }) {
  const w = plan.meta?.window;
  const at = plan.meta?.computedAt;
  const t = plan.trend;

  const age = (() => {
    if (!at) return null;
    const m = Math.max(0, Math.round((Date.now() / 1000 - at) / 60));
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
  })();

  return (
    <p className={styles.muted}>
      {[
        w?.days ? `Meta ${w.days}d to ${w.to}` : 'Meta board',
        age,
        // NOT A CLAIM THAT IT IS ON. `applied` is false until enough days of
        // meta history are stored.
        t?.applied ? `trend ${t.days}d · ${t.moved} moved` : t ? 'trend off' : null,
      ]
        .filter(Boolean)
        .join(' · ')}
    </p>
  );
}

function sharedLine(p: FieldPick): string | null {
  const a = p.affinity;
  if (!a) return null;
  const bits: string[] = [];
  if (a.familiar) bits.push(`${a.shared}/${a.of} of one deck`);
  else if (a.knowsCards) bits.push(`${a.known}/${a.of} your cards`);
  else return null;
  if (a.familiar && a.deckBattles) bits.push(`${a.deckBattles} games`);
  return p.closestOfFamily ? `Closest yours · ${bits.join(' · ')}` : bits.join(' · ');
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
          {/* The unit is stated once, on the card. Sixty-eight rows do not
              each need to repeat "expected against the field". */}
          <span>
            <strong>{p.expectedWinRate.toFixed(1)}%</strong>
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

  return (
    <ChartCard
      title={self ? 'Closest to how you play' : 'Closest to how they play'}
      note={
        rep
          ? `${rep.sharedFloor}+/8 shared · ${rep.decks} deck${rep.decks === 1 ? '' : 's'} at ${rep.deckFloor}+ games · expected % vs field`
          : undefined
      }
      badge={near.length > 0 ? String(near.length) : 'None'}
    >
      {near.length === 0 ? (
        <p className={styles.muted}>
          {/* STILL TWO DIFFERENT REASONS — no repertoire, or a repertoire
              nothing matches — because they mean opposite things. Stated as
              facts rather than explained. */}
          {!rep || rep.decks === 0
            ? `No deck at ${rep?.deckFloor ?? 5}+ games in this window.`
            : `${rep.decks} deck${rep.decks === 1 ? '' : 's'}, none within ${rep.sharedFloor}/8 of the field's answers. See Worth learning.`}
        </p>
      ) : (
        <ul className={styles.deckList}>
          {near.map((p) => (
            <DeckRow key={p.key} p={p} note={sharedLine(p)} />
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
  const your = self ? 'your' : 'their';
  return (
    <ChartCard
      title="Worth learning"
      note="New win condition that beats their best"
      badge={learn ? learn.name : 'None'}
    >
      {!learn ? (
        <p className={styles.muted}>
          {/* NULL IS A REAL ANSWER — a new archetype costs weeks and is only
              offered when it actually wins. */}
          Nothing unplayed beats {your} own decks.
        </p>
      ) : (
        <>
          <InsightRow
            icon={<TrendIcon />}
            tone="good"
            title={
              learn.beats != null
                ? `${learn.name} · ${learn.expectedWinRate.toFixed(1)}% · +${learn.beats.toFixed(1)} vs ${your} best`
                : `${learn.name} · ${learn.expectedWinRate.toFixed(1)}%`
            }
            description={
              learn.yourBattles === 0
                ? 'Never played'
                : `${learn.yourBattles} game${learn.yourBattles === 1 ? '' : 's'}${
                    learn.yourShare != null ? ` · ${learn.yourShare}%` : ''
                  }`
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
          {g.knows > 0 && <span className={styles.oppTag}> · {g.knows}</span>}
        </button>
      ))}
    </div>
  );

  return (
    <ChartCard
      title="Every way to answer this field"
      note={
        mine.length > 0
          ? `${mine.length} ${self ? 'yours' : 'theirs'} first, then the field · best % first`
          : 'Best % first · nothing built from their cards'
      }
      badge={String(fams.length)}
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
          <p className={styles.muted}>{self ? 'Yours' : 'Theirs'}</p>
          {chips(mine)}
        </>
      )}
      {rest.length > 0 && (
        <>
          <p className={styles.muted}>{mine.length > 0 ? 'Rest of field' : 'The field'}</p>
          {chips(rest)}
        </>
      )}
      <FreshnessLine plan={plan} />
      {fams
        .filter((g) => g.archetype === open)
        .map((g) => (
          <div key={g.archetype}>
            <p className={styles.muted}>
              {[`${g.total} decks`,
                g.knows > 0 ? `${g.knows} ${self ? 'yours' : 'theirs'}` : null,
                `top ${g.decks.length}`].filter(Boolean).join(' · ')}
            </p>
            <ul className={styles.deckList}>
              {g.decks.map((p) => (
                <DeckRow key={p.key} p={p} note={sharedLine(p)} />
              ))}
            </ul>
          </div>
        ))}
    </ChartCard>
  );
}

export { DeckRow };
