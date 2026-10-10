import { useState } from 'react';
import type {
  BringCard,
  BringReport,
  CardShare,
  PlaysFamily,
  TeamRecommendation,
} from '../../state/analyticsClient';
import { CARDS_BY_KEY } from '../../data/cards';
import { CardArt } from './CardArt';
import { DeckActions } from '../DeckActions/DeckActions';
import { Tabs } from '../ui/tabs';
import { drawnDeck, formInferred } from '../../utils/deckSeating';
import { duelChip, duelDeckLabel, duelTitle } from '../../utils/duelFigures';
import { BRING_VIEWS, familyChips, shareLabel, type BringView } from '../../utils/bringAgainst';
import styles from './BringAgainst.module.css';

/**
 * BRING THIS AGAINST THEM — the Deck Counter's list of what to play.
 *
 * It is the scouting engine's answer for this one player
 * (`server/team_analysis.bring`): the same pool — every vetted ladder list and
 * every duel list — and the same figures as Team Analysis, so the two screens
 * cannot disagree about a deck.
 *
 * WHAT IT REPLACED, and why: a restatement of the player's own worst matchups
 * from "your" side. Measured before it went (2026-10-10): more than a third of
 * the rows it told a reader to bring had a rate under 50% by its own figure,
 * and the deck beside each row was the list of that archetype the player had
 * MET most — the meta's list, so six different players were shown the same
 * eight cards. The account holder's words: "very generic, relies on the meta —
 * we need decks which counter their archetypes, whatever they play, at a good
 * percentage".
 *
 * THREE READINGS OF ONE RATED POOL, on three tabs:
 *
 *   Best counters      the strongest decks against everything they play
 *   By their archetype the best counters to each archetype they play
 *   By counter card    the cards that answer what they play, and the best
 *                      decks holding each
 *
 * FIGURES AND CARD ART, NO SENTENCES. One short line under the tabs says what
 * the percentage on that tab is measured against, and nothing explains a
 * number that is already on the screen.
 */

function pct(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : `${n.toFixed(1)}%`;
}

function cardName(key: string): string {
  return CARDS_BY_KEY.get(key)?.name ?? key;
}

/** What the big figure on each tab is measured against. */
const VIEW_NOTE: Record<BringView, string> = {
  best: 'Win rate against everything they play.',
  family: 'Win rate against that archetype of theirs.',
  card: 'Cards that answer what they play, and the best decks holding each.',
};

/** One of THEIR cards, small, with the share of their games it is in. */
function TheirCard({ c, plain }: { c: CardShare; plain?: boolean }) {
  return (
    <span
      className={styles.theirCard}
      title={`${cardName(c.card)} — in ${shareLabel(c.share)} of their games`}
    >
      <CardArt card={c.card} />
      {!plain && <span className={styles.theirShare}>{shareLabel(c.share)}</span>}
    </span>
  );
}

/** One suggested deck: the eight cards, the figure, and how it does against
 *  each archetype they play. */
function BringDeck({
  deck,
  plays,
  rank,
  figure,
  figureTitle,
  skip,
}: {
  deck: TeamRecommendation;
  plays: PlaysFamily[];
  rank?: number;
  /** The figure to lead with. Defaults to the rate against everything. */
  figure?: number;
  figureTitle?: string;
  /** A family whose chip is not drawn — the one the figure already is. */
  skip?: string;
}) {
  const d = drawnDeck(deck.cards, deck.art, deck.artInferred, deck.artFilled);
  const chips = familyChips(deck, plays, skip);
  return (
    <li className={styles.deck}>
      <div className={styles.deckHead}>
        {rank !== undefined && <span className={styles.rank}>{rank}</span>}
        <span className={styles.deckName}>{deck.name}</span>
        {duelDeckLabel(deck) && <span className={styles.duelPill}>{duelDeckLabel(deck)}</span>}
        {/* THE DUELS' OWN FIGURE, ONLY WHEN IT AGREES. The percentage on this
            row already holds the duel games (four ladder games each). A second
            figure beside it that says something else — "Duel 48%" on a row at
            66% — was half of what made these lists read as inconsistent, so it
            is drawn as proof or not at all. */}
        {deck.duel?.strong && (
          <span className={styles.duelFig} data-strong title={duelTitle(deck.duel)}>
            {duelChip(deck.duel)}
          </span>
        )}
        <span className={styles.figure} title={figureTitle}>
          {pct(figure ?? deck.expectedWinRate)}
        </span>
      </div>
      <div className={styles.cards}>
        {d.cards.map((c, i) => (
          <CardArt key={`${c}-${i}`} card={c} variant={d.art[c]} inferred={formInferred(d, c)} />
        ))}
      </div>
      <div className={styles.deckFoot}>
        {chips.length > 0 && (
          <ul className={styles.chips}>
            {chips.map((c) => (
              <li
                key={c.family}
                className={styles.chip}
                data-ok={c.ok || undefined}
                data-answer={c.answer || undefined}
                title={`Against their ${c.name}`}
              >
                <span>{c.name}</span>
                <strong>{c.rate.toFixed(0)}%</strong>
              </li>
            ))}
          </ul>
        )}
        <DeckActions cards={d.cards} name={deck.name} size="sm" className={styles.actions} art={d.art} />
      </div>
    </li>
  );
}

function ByCard({ view, plays }: { view: NonNullable<BringReport['byCard']>; plays: PlaysFamily[] }) {
  const [open, setOpen] = useState<string | null>(view.cards[0]?.card ?? null);
  const card: BringCard | undefined = view.cards.find((c) => c.card === open) ?? view.cards[0];
  return (
    <>
      <div className={styles.theirs} data-their-cards>
        <span className={styles.theirsLabel}>Their cards</span>
        {view.theirCards.map((c) => (
          <TheirCard key={c.card} c={c} />
        ))}
      </div>

      {view.cards.length === 0 ? (
        <p className={styles.empty}>No card stands out against what they play.</p>
      ) : (
        <>
          <div className={styles.counterCards} role="group" aria-label="Counter cards">
            {view.cards.map((c) => (
              <button
                key={c.card}
                type="button"
                className={styles.counterCard}
                aria-pressed={c.card === card?.card}
                data-counter-card={c.card}
                onClick={() => setOpen(c.card)}
                title={`${cardName(c.card)} — decks holding it do ${c.lift.toFixed(1)} points better against what they play`}
              >
                <CardArt card={c.card} />
                <span className={styles.counterName}>{cardName(c.card)}</span>
                <span className={styles.counterLift}>+{c.lift.toFixed(1)}</span>
              </button>
            ))}
          </div>

          {card && (
            <section className={styles.cardPanel} data-card-panel={card.card}>
              <div className={styles.cardWhy}>
                {card.why === 'answers' ? (
                  <>
                    <span className={styles.theirsLabel}>Answers their</span>
                    {card.answers.map((c) => (
                      <TheirCard key={c.card} c={c} />
                    ))}
                  </>
                ) : (
                  <>
                    <span className={styles.theirsLabel}>
                      {card.open.length ? 'Their only answers' : 'They carry no answer'}
                    </span>
                    {card.open.map((c) => (
                      <TheirCard key={c.card} c={c} />
                    ))}
                  </>
                )}
              </div>
              <ol className={styles.decks}>
                {card.decks.map((d) => (
                  <BringDeck key={d.key ?? d.cards.join(',')} deck={d} plays={plays} />
                ))}
              </ol>
            </section>
          )}
        </>
      )}
    </>
  );
}

export function BringAgainst({ bring }: { bring: BringReport }) {
  const [view, setView] = useState<BringView>('best');
  const views = BRING_VIEWS.filter((v) => v.id !== 'card' || bring.byCard);

  if (bring.reason || bring.decks.length === 0) {
    return (
      <p className={styles.empty}>
        {bring.reason === 'no_history'
          ? 'No own-deck battles stored for this player in this window.'
          : 'No measured counters to what they play yet.'}
      </p>
    );
  }

  return (
    <div className={styles.root} data-bring>
      <ul className={styles.plays} aria-label="They play">
        <li className={styles.playsLabel}>They play</li>
        {bring.plays.map((p) => (
          <li key={p.family} className={styles.play} title={`${p.games} games, ${p.decks} lists`}>
            <span>{p.name}</span>
            <strong>{shareLabel(p.share)}</strong>
          </li>
        ))}
      </ul>

      <Tabs
        label="Bring this against them"
        size="sm"
        items={views.map((v) => ({ id: v.id, label: v.label }))}
        value={view}
        onChange={setView}
      />
      <p className={styles.note}>{VIEW_NOTE[view]}</p>

      {view === 'best' && (
        <ol className={styles.decks} data-view="best">
          {bring.decks.map((d, i) => (
            <BringDeck
              key={d.key ?? d.cards.join(',')}
              deck={d}
              plays={bring.plays}
              rank={i + 1}
              figureTitle="Expected win rate against everything they play, weighted by how much they play each deck."
            />
          ))}
        </ol>
      )}

      {view === 'family' && (
        <div className={styles.groups} data-view="family">
          {bring.byFamily.map((g) => (
            <section key={g.family} className={styles.group} data-family={g.family}>
              <h3 className={styles.groupHead}>
                <span>vs their {g.name}</span>
                <strong>{shareLabel(g.share)}</strong>
              </h3>
              {g.decks.length === 0 ? (
                <p className={styles.empty}>Nothing in the pool beats it at 55%.</p>
              ) : (
                <ol className={styles.decks}>
                  {g.decks.map((d) => (
                    <BringDeck
                      key={d.key ?? d.cards.join(',')}
                      deck={d}
                      plays={bring.plays}
                      figure={d.rate}
                      figureTitle={`Win rate against their ${g.name}.`}
                      skip={g.family}
                    />
                  ))}
                </ol>
              )}
            </section>
          ))}
        </div>
      )}

      {view === 'card' && bring.byCard && (
        <div data-view="card">
          <ByCard view={bring.byCard} plays={bring.plays} />
        </div>
      )}
    </div>
  );
}
