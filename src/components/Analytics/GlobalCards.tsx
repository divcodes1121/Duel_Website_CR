import { useEffect, useMemo, useState } from 'react';
import { CARDS } from '../../data/cards';
import type { Card } from '../../types/card';
import {
  fetchGlobalCards,
  type GlobalCard,
  type GlobalCardBoard,
} from '../../state/analyticsClient';
import { CardArt } from './CardArt';
import styles from './GlobalCards.module.css';

const pct = (v: number) => `${v.toFixed(1)}%`;
const num = (v: number) => v.toLocaleString();

type TabId = 'all' | 'troop' | 'building' | 'spell' | 'wincon' | 'champion' | 'evolution' | 'hero';

const TABS: { id: TabId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'troop', label: 'Troops' },
  { id: 'building', label: 'Buildings' },
  { id: 'spell', label: 'Spells' },
  { id: 'wincon', label: 'Win Cons' },
  { id: 'champion', label: 'Champions' },
  { id: 'evolution', label: 'Evolutions' },
  { id: 'hero', label: 'Heroes' },
];

/** The two form tabs read the FORM's figures, not the card's. That is the whole
 *  point of them: an evolved Skeletons is a different card and is scored as one. */
const FORM_TAB: Partial<Record<TabId, 'evolution' | 'hero'>> = {
  evolution: 'evolution',
  hero: 'hero',
};

function matches(card: Card, tab: TabId): boolean {
  switch (tab) {
    case 'troop':
      return card.type === 'Troop';
    case 'building':
      return card.type === 'Building';
    case 'spell':
      return card.type === 'Spell';
    case 'wincon':
      return card.isWinCondition;
    case 'champion':
      return card.isChampion;
    case 'evolution':
      return card.canEvolve;
    case 'hero':
      return card.canBeHero;
    default:
      return true;
  }
}

interface Row {
  card: Card;
  stat: GlobalCard | undefined;
  /** What the tile prints — the card's figures, or the form's on a form tab. */
  useRate: number;
  winRate: number | null;
  battles: number;
  /** The plain card's win rate. TOOLTIP ONLY — a form tile prints the same two
   *  figures as every other tab, so the grid stays one shape and a third
   *  percentage does not compete with the two that are being compared. */
  baseWinRate: number | null;
}

export function GlobalCards() {
  const [board, setBoard] = useState<GlobalCardBoard | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<TabId>('all');
  const [sort, setSort] = useState<'use' | 'win'>('use');

  useEffect(() => {
    let live = true;
    let timer = 0;
    const load = () => {
      fetchGlobalCards()
        .then((b) => {
          if (!live) return;
          setBoard(b);
          // The rollup is a background snapshot; while it builds there is
          // nothing to show, so poll rather than presenting an empty board as
          // an answer.
          if (b.building) timer = window.setTimeout(load, 5000);
        })
        .catch(() => live && setFailed(true));
    };
    load();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, []);

  const byKey = useMemo(() => {
    const m = new Map<string, GlobalCard>();
    for (const c of board?.cards ?? []) m.set(c.key, c);
    return m;
  }, [board]);

  const form = FORM_TAB[tab];

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const card of CARDS) {
      if (!matches(card, tab)) continue;
      const stat = byKey.get(card.key);
      const f = form ? stat?.forms?.[form] : undefined;
      const base = stat?.forms?.base;
      out.push({
        card,
        stat,
        // On a form tab a use rate is a share of the battles that RECORDED a
        // form, which the footer says is not comparable with the other tabs'.
        useRate: form ? (f?.share ?? 0) : (stat?.useRate ?? 0),
        winRate: form ? (f?.winRate ?? null) : (stat?.winRate ?? null),
        battles: form ? (f?.battles ?? 0) : (stat?.battles ?? 0),
        baseWinRate: form ? (base?.winRate ?? null) : null,
      });
    }
    out.sort((a, b) => {
      // An unranked card never outranks a ranked one however high it reads.
      if (sort === 'win') {
        const av = a.winRate ?? -1;
        const bv = b.winRate ?? -1;
        if (av !== bv) return bv - av;
      }
      if (a.useRate !== b.useRate) return b.useRate - a.useRate;
      return a.card.name.localeCompare(b.card.name);
    });
    return out;
  }, [byKey, tab, form, sort]);

  const cov = board?.formCoverage;
  const building = board?.building && !(board?.cards ?? []).length;

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>Cards</h1>
          <p className={styles.blurb}>
            Use rate and win rate for every card across the whole player base — not one player.
            An evolved card is scored apart from the plain one.
          </p>
        </div>
        {board?.window?.from && (
          <span className={styles.window}>
            {board.window.days} days to {board.window.to}
            {board.ageSeconds != null && (
              <span className={styles.age}>
                snapshot {Math.round(board.ageSeconds / 60)} min old
              </span>
            )}
          </span>
        )}
      </header>

      <div className={styles.controls}>
        <div className={styles.tabs} role="tablist" aria-label="Card group">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <label className={styles.sort}>
          <span className={styles.sortLabel}>Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as 'use' | 'win')}>
            <option value="use">Use rate</option>
            <option value="win">Win rate</option>
          </select>
        </label>
      </div>

      {failed && (
        <p className={styles.note}>
          The analytics service is not running, so there are no figures to show.
        </p>
      )}
      {building && !failed && (
        <p className={styles.note}>
          Building the rollup — the scan takes a couple of minutes and this page will fill itself
          in when it lands.
        </p>
      )}

      {form && (
        <p className={styles.formNote}>
          These are the <strong>{form}</strong> figures, counted only from battles that recorded
          which form was fielded
          {cov?.battles
            ? ` — ${num(cov.battles)} of them, over ${cov.days} days`
            : ''}
          . A form&apos;s use rate is a share of that subset, so it is not comparable with the
          other tabs&apos;. Hover a card for the same card&apos;s plain win rate.
        </p>
      )}

      <div className={styles.grid}>
        {rows.map((r) => (
          <Tile key={r.card.key} row={r} form={form} />
        ))}
      </div>

      <p className={styles.footer}>
        Use rate is a share of every competitive battle in the window — ladder, ranked 1v1,
        clan-war 1v1 and tournaments. 2v2 and the event modes that hand you a deck are excluded,
        because they would measure Supercell&apos;s choices rather than the player base&apos;s.
      </p>
    </section>
  );
}

function Tile({ row, form }: { row: Row; form?: 'evolution' | 'hero' }) {
  const { card } = row;
  const has = row.battles > 0;
  const title = has
    ? `${card.name}${form ? ` (${form})` : ''} — ${pct(row.useRate)} use, ${
        row.winRate == null ? 'no win rate' : pct(row.winRate)
      } over ${num(row.battles)} battles${
        row.baseWinRate == null ? '' : `; plain ${pct(row.baseWinRate)}`
      }`
    : form
      ? `${card.name} — never observed as ${form}`
      : `${card.name} — no stored battles in this window`;

  return (
    <div className={styles.tile} data-empty={!has || undefined} title={title}>
      <CardArt card={card.key} variant={form} className={styles.tileArt} />
      <span className={styles.tileName}>{card.name}</span>
      {has ? (
        <>
          <span className={styles.tileRates}>
            <span className={styles.use}>{pct(row.useRate)}</span>
            <span className={styles.win}>{row.winRate == null ? '–' : pct(row.winRate)}</span>
          </span>
        </>
      ) : (
        <span className={styles.tileNone}>{form ? `no ${form} data` : 'not played'}</span>
      )}
    </div>
  );
}
