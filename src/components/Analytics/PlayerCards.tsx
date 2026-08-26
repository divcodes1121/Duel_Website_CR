import { useEffect, useMemo, useState } from 'react';
import { CardArt, type ArtVariant } from './CardArt';
import { ReportButton } from '../Export/ReportButton';
import { cardBoardDoc } from '../../utils/reportAdapters';
import { CARDS_BY_KEY } from '../../data/cards';
import {
  AnalyticsError,
  fetchCardBoard,
  type ApiCardRow,
  type CardBoard,
  type CardMode,
} from '../../state/analyticsClient';
import { ReadingState } from './ReadingState';
import { RANGE_PRESETS, useDateWindow, type Season } from './playerData';
import styles from './PlayerCards.module.css';
import { useHeldLoading } from '../../hooks/useHeldLoading';

/* Cards — every card, as THIS player plays it.
 *
 * Scoped to a loaded tag on purpose: it answers "what do they run and how does
 * it do for them", which is a different question from the global meta board.
 *
 *   * All 122 cards are listed, including ones they have never played. "Which
 *     cards do they not touch" is a real question about a card board, and a
 *     zero row answers it.
 *   * Win rate is only RANKED where there is evidence behind it — the pair
 *     board's floor, reused. Below it a card still appears, marked, rather than
 *     sitting at #1 on a single lucky game.
 *   * Win Conditions, Champions and Evolutions used to be their own sidebar
 *     sections. They were never separate screens — they are ways of looking at
 *     the card list, so they are tabs here.
 *
 * Every filter runs client-side over 122 rows: type, elixir, rarity and the
 * three category tabs all come from `cards.json` + `cardMeta.json`, which the
 * browser already has for the art. Only the counts come from the server.
 */

type Tab =
  | 'all'
  | 'troops'
  | 'buildings'
  | 'spells'
  | 'wincons'
  | 'champions'
  | 'evolutions'
  | 'heroes';

const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'troops', label: 'Troops' },
  { id: 'buildings', label: 'Buildings' },
  { id: 'spells', label: 'Spells' },
  { id: 'wincons', label: 'Win Conditions' },
  { id: 'champions', label: 'Champions' },
  { id: 'evolutions', label: 'Evolutions' },
  { id: 'heroes', label: 'Heroes' },
];

/* Which ART the grid draws, per tab.
 *
 * The Evolutions tab used to list the 42 evolution-capable cards drawn in their
 * BASE art, and there was no Heroes tab at all — so the evolution and hero
 * artwork, which the app ships and every other screen uses, appeared nowhere on
 * the one screen actually about those forms. A tab that exists to show you the
 * evolutions should show you the evolutions.
 *
 * Everywhere else stays base art deliberately: on the All tab a row's figures
 * are the card's whole record across both forms, so drawing one form's art
 * against a combined number would be a claim the data does not make.
 *
 * `CardArt` falls back to the base image if a PNG is missing, but nothing here
 * relies on that — the metadata and the files agree exactly, 42 evolutions and
 * 16 heroes, checked against `public/assets/`. */
const TAB_ART: Partial<Record<Tab, ArtVariant>> = {
  evolutions: 'evolution',
  heroes: 'hero',
};

const MODES: { id: CardMode; label: string }[] = [
  { id: 'all', label: 'All modes' },
  { id: 'ranked', label: 'Ranked' },
  { id: 'duel', label: 'Duels' },
  { id: 'tournament', label: 'Tournament' },
];

const RARITIES = ['Common', 'Rare', 'Epic', 'Legendary', 'Champion'] as const;

/* Use rate is the DEFAULT, and it leads the list.
 *
 * Sorting by win rate first put the board's own caveat at the top of it: the
 * cards with the highest win rate are overwhelmingly the ones with the fewest
 * battles behind them, so the opening screen was a list of cards this player
 * has barely touched. Use rate has no such problem — it is a count, it needs
 * no evidence floor, and "what do they actually play" is the question a card
 * board is opened to answer. Win rate is one select away and still ranks
 * evidence-first when chosen. */
type Sort = 'use' | 'win' | 'played' | 'elixir';
const SORTS: { id: Sort; label: string }[] = [
  { id: 'use', label: 'Use rate' },
  { id: 'win', label: 'Win rate' },
  { id: 'played', label: 'Most played' },
  { id: 'elixir', label: 'Elixir' },
];
const DEFAULT_SORT: Sort = 'use';

const ICONS = {
  cards: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="12" height="16" rx="2" />
      <path d="M17 7h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  ),
  trend: (
    <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </svg>
  ),
  trophy: (
    <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
      <path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" />
      <path d="M10 19h4M12 14v5" />
    </svg>
  ),
  reset: (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  ),
};

const nf = new Intl.NumberFormat('en-US');
const pct = (v: number) => `${v.toFixed(1)}%`;

function shortDay(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00Z');
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/* Movement against the previous window is NOT drawn on the tile any more. At
 * this density a third line of figures is what was making the grid twice as
 * tall for the same twelve cards; the deltas, the battle count, the confidence
 * interval and the evolved share all moved into the tile's tooltip, where they
 * are one hover away and cost no space. */

/* The figures a tile prints.
 *
 * On the ordinary tabs those are the card's own, over every battle. On the
 * Evolutions and Heroes tabs they are the FORM's — an evolved Skeletons is a
 * different card to play and gets its own use rate and its own win rate, which
 * is the whole reason those tabs exist. `base` comes back with it so the tile
 * can print the comparison, which is the number people actually want: 60.0%
 * plain against 42.9% evolved says something neither figure says alone. */
function figuresFor(row: ApiCardRow, art?: ArtVariant) {
  if (!art) {
    return { shown: row, form: undefined, base: undefined, missing: false };
  }
  const form = row.forms?.[art];
  return {
    shown: form,
    form,
    base: row.forms?.base,
    // Seen in no battle that recorded a form. Not the same as "played this
    // form zero times" — nothing was observed either way.
    missing: !form,
  };
}

function CardTile({
  row,
  useScale,
  art,
}: {
  row: ApiCardRow;
  useScale: number;
  /** Which form to draw AND to score — set by the open tab. See TAB_ART. */
  art?: ArtVariant;
}) {
  const card = CARDS_BY_KEY.get(row.key);
  const { shown, base, missing } = figuresFor(row, art);
  const unplayed = art ? missing : row.battles === 0;
  const formWord = art === 'hero' ? 'as a hero' : 'evolved';

  const detail = unplayed
    ? art
      ? `${card?.name ?? row.key} — never recorded ${formWord} in this window`
      : `${card?.name ?? row.key} — never played in this window`
    : [
        `${card?.name ?? row.key}${art ? ` (${art})` : ` · rank ${row.rank}`}`,
        `${card?.elixir ?? '?'} elixir · ${card?.rarity ?? ''}`.trim(),
        shown ? `${nf.format(shown.battles)} battles, ${shown.wins} won` : null,
        shown ? `use ${pct(shown.useRate)}` : null,
        shown ? `win ${pct(shown.winRate)}` : null,
        shown?.interval ? `95% CI ${shown.interval}` : null,
        shown && !shown.tiered
          ? `under the ${shown.battles}-battle floor — not ranked`
          : null,
        // The comparison, spelled out. This is the point of the special tabs.
        art && base
          ? `plain ${card?.name ?? row.key}: ${pct(base.winRate)} over ${nf.format(base.battles)} battles`
          : null,
        art && !base ? 'never recorded in its plain form here' : null,
        art ? null : `${nf.format(row.battles)} battles, ${row.wins} won`,
        art || row.useDelta === undefined
          ? null
          : `use moved ${row.useDelta > 0 ? '+' : ''}${row.useDelta.toFixed(1)}`,
        art || row.winDelta === undefined
          ? null
          : `win moved ${row.winDelta > 0 ? '+' : ''}${row.winDelta.toFixed(1)}`,
        // Two different special forms, reported separately — see the note on
        // the server's _tally. A card can have both.
        !art && row.evoRate > 0 ? `${pct(row.evoRate)} of its play was evolved` : null,
        !art && row.heroRate > 0 ? `${pct(row.heroRate)} of its play was as a hero` : null,
      ]
        .filter(Boolean)
        .join('\n');

  return (
    <article className={styles.tile} data-unplayed={unplayed ? '' : undefined} title={detail}>
      {/* Art only. The elixir cost used to sit in a badge over the corner and
          was removed on request — at this density the grid is scanned as
          pictures, and the number is still one hover away in the tooltip along
          with the rank, the battle count and the confidence interval. The
          elixir FILTER and sort are untouched; it is the printed digit that was
          noise. */}
      <span className={styles.artWrap}>
        <CardArt card={row.key} variant={art} className={styles.art} />
      </span>

      <span className={styles.name}>{card?.name ?? row.key}</span>

      {unplayed || !shown ? (
        <span className={styles.never}>{art ? `no ${art} data` : 'not played'}</span>
      ) : (
        <>
          {/* Both measures on ONE line, each in its own hue and each printing
              its own number — the two hues are the app's CVD-validated data
              pair, and the printed figure is the secondary encoding that makes
              them legal for a viewer who cannot separate them. */}
          <span className={styles.rates}>
            <span className={styles.rate} data-kind="use">
              {ICONS.trend}
              {pct(shown.useRate)}
            </span>
            {/* A win rate under the evidence floor is printed in the muted
                neutral rather than the success hue: the figure is still shown,
                it just does not get to look like a result. Quieter than the
                "THIN" chip it replaces, and it needs no space of its own. */}
            <span className={styles.rate} data-kind={shown.tiered ? 'win' : 'thin'}>
              {ICONS.trophy}
              {pct(shown.winRate)}
            </span>
          </span>

          <span className={styles.bars} aria-hidden="true">
            <span className={styles.bar}>
              <span
                className={styles.fill}
                data-kind="use"
                style={{ width: `${useScale > 0 ? Math.min(100, (shown.useRate / useScale) * 100) : 0}%` }}
              />
            </span>
            <span className={styles.bar}>
              <span
                className={styles.fill}
                data-kind={shown.tiered ? 'win' : 'thin'}
                style={{ width: `${shown.winRate}%` }}
              />
            </span>
          </span>
        </>
      )}
    </article>
  );
}

/* Four rows at the density the grid now runs, rather than the two that 24 gave
   once the tiles halved in width. */
const PAGE = 48;

export function PlayerCards({ tag, season = 'Current Season' }: { tag: string; season?: Season }) {
  const [board, setBoard] = useState<CardBoard | null>(null);
  const [error, setError] = useState<AnalyticsError | null>(null);
  const [loading, setLoading] = useState(true);
  const reading = useHeldLoading(loading);

  const [mode, setMode] = useState<CardMode>('all');
  const [tab, setTab] = useState<Tab>('all');
  const [rarity, setRarity] = useState<string>('all');
  const [elixir, setElixir] = useState<string>('all');
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [query, setQuery] = useState('');
  const [hideUnplayed, setHideUnplayed] = useState(true);
  const [shown, setShown] = useState(PAGE);
  const [pickerOpen, setPickerOpen] = useState(false);

  const { win, preset, setPreset, custom, setCustom } = useDateWindow(
    season,
    board?.coverage.end ?? null,
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    fetchCardBoard(tag, win, mode)
      .then((r) => {
        if (!live) return;
        setBoard(r);
        setError(null);
      })
      .catch((e) => {
        if (!live) return;
        setBoard(null);
        setError(e as AnalyticsError);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag, mode, preset, win.from, win.to]);

  // Any change to what is being asked resets the page back to the top of the
  // list — "show more" from a previous filter is not more of this one.
  useEffect(() => setShown(PAGE), [tab, rarity, elixir, sort, query, hideUnplayed, mode]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPickerOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickerOpen]);

  /* On a form tab every figure on screen is the FORM's, so the filter, the
     sort and the bar scale all have to read the same numbers the tile prints —
     otherwise "sort by win rate" would order the grid by a figure that is
     nowhere on it. One accessor, used by all three. */
  const art = TAB_ART[tab];
  const rows = useMemo(() => {
    if (!board) return [];
    const q = query.trim().toLowerCase();
    const stat = (r: ApiCardRow) => (art ? r.forms?.[art] : r);
    const out = board.cards.filter((r) => {
      const c = CARDS_BY_KEY.get(r.key);
      if (!c) return false;
      /* "Never played" means never played THE CARD — not never recorded in
         this form. Making it the latter hid ten of the forty-two evolution
         cards, Elite Barbarians among them: 56 battles on the card and zero
         marked as evolved, so a tab whose entire job is to list the evolutions
         was dropping it.
         The reason that is wrong is coverage. `player_evo` records the form for
         about a quarter of battles, so "no evolved record" mostly means "not
         observed", not "never evolved" — absence of a mark is not evidence of
         absence. The card stays listed and its tile says "no evolution data",
         which is the honest version of the same fact. */
      if (hideUnplayed && r.battles === 0) return false;
      if (q && !c.name.toLowerCase().includes(q) && !r.key.includes(q)) return false;
      if (rarity !== 'all' && c.rarity !== rarity) return false;
      if (elixir !== 'all' && String(c.elixir) !== elixir) return false;
      switch (tab) {
        case 'troops':
          return c.type === 'Troop';
        case 'buildings':
          return c.type === 'Building';
        case 'spells':
          return c.type === 'Spell';
        case 'wincons':
          return c.isWinCondition;
        case 'champions':
          return c.isChampion;
        case 'evolutions':
          return c.canEvolve;
        case 'heroes':
          return c.canBeHero;
        default:
          return true;
      }
    });
    const key = (r: ApiCardRow) => {
      const c = CARDS_BY_KEY.get(r.key);
      const s = stat(r);
      // A card with no record in this form sorts to the bottom of every order
      // rather than to the top on a zero.
      const use = s?.useRate ?? -1;
      const bat = s?.battles ?? -1;
      const winr = s?.winRate ?? -1;
      switch (sort) {
        case 'use':
          return [-use, -bat];
        case 'played':
          return [-bat, -winr];
        case 'elixir':
          return [c?.elixir ?? 0, -use];
        default:
          // Evidence first, exactly as the server ranks: an unranked card never
          // outranks a ranked one however high its percentage reads.
          return [s?.tiered ? 0 : 1, -winr, -bat];
      }
    };
    return out.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
      return a.key.localeCompare(b.key);
    });
  }, [board, tab, rarity, elixir, sort, query, hideUnplayed, art]);

  /* One ruler for every use-rate bar, taken from the whole filtered list rather
     than the visible page — "show more" must not rescale the rows already on
     screen. Win-rate bars are absolute 0-100 instead: half a bar means half the
     games, which is a real reading, where a use rate of 7.8% is only meaningful
     against the other cards.

     On a form tab the ruler is the FORM's use rates, so the bars are scaled
     against the column they are actually in. */
  const useScale = Math.max(
    1,
    ...rows.map((r) => (art ? (r.forms?.[art]?.useRate ?? 0) : r.useRate)),
  );

  if (reading) {
    return (
      <div className={styles.page}>
        <ReadingState k="player-cards" hue="blue">
          Reading card history…
        </ReadingState>
      </div>
    );
  }

  if (error || !board) {
    const offline = error?.kind === 'offline';
    return (
      <div className={styles.page}>
        <section className={styles.notice}>
          <h2 className={styles.noticeTitle}>
            {offline ? 'Analytics service is not running' : 'No stored battles for that tag'}
          </h2>
          <p className={styles.noticeBody}>{offline ? error?.message : `Nothing stored for ${tag}.`}</p>
          {offline && <pre className={styles.noticeCode}>python server/app.py</pre>}
        </section>
      </div>
    );
  }

  const { totals } = board;
  const dirty =
    tab !== 'all' ||
    rarity !== 'all' ||
    elixir !== 'all' ||
    sort !== DEFAULT_SORT ||
    query !== '' ||
    !hideUnplayed;
  const reset = () => {
    setTab('all');
    setRarity('all');
    setElixir('all');
    setSort(DEFAULT_SORT);
    setQuery('');
    setHideUnplayed(true);
  };

  return (
    <div className={styles.page}>
      <section className={styles.panel}>
        <header className={styles.head}>
          <span className={styles.headIcon}>{ICONS.cards}</span>
          <div className={styles.headText}>
            <h1 className={styles.title}>Best Cards</h1>
            <p className={styles.blurb}>
              {MODES.find((m) => m.id === mode)?.label} · {shortDay(board.window.from)} –{' '}
              {shortDay(board.window.to)} · {nf.format(totals.battles)} battles ·{' '}
              {totals.played} of {totals.cards} cards played
            </p>
          </div>

          <div className={styles.range}>
            <ReportButton build={() => cardBoardDoc(board, tag)} />
            {RANGE_PRESETS.filter((r) => r.days >= 0).map((r) => (
              <button
                key={r.label}
                type="button"
                className={`${styles.chip} ${preset === r.days ? styles.chipOn : ''}`}
                data-beyond={r.days > 0 && r.days > board.coverage.days ? '' : undefined}
                onClick={() => {
                  setPreset(r.days);
                  setPickerOpen(false);
                }}
              >
                {r.label.replace('Last ', '').replace(' Days', 'd').replace('All Data', 'All')}
              </button>
            ))}
            <span className={styles.customWrap}>
              <button
                type="button"
                className={`${styles.chip} ${preset === -1 ? styles.chipOn : ''}`}
                aria-expanded={pickerOpen}
                onClick={() => setPickerOpen((o) => !o)}
              >
                {ICONS.calendar}
                {preset === -1 && custom.from && custom.to
                  ? `${shortDay(custom.from)} – ${shortDay(custom.to)}`
                  : 'Custom'}
                {ICONS.chevron}
              </button>
              {pickerOpen && (
                <div className={styles.customPop}>
                  <span className={styles.customLabel}>Custom range</span>
                  <label className={styles.customField}>
                    <span>From</span>
                    <input
                      type="date"
                      value={custom.from || board.window.from || ''}
                      min={board.coverage.start ?? undefined}
                      max={custom.to || board.coverage.end || undefined}
                      onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                    />
                  </label>
                  <label className={styles.customField}>
                    <span>To</span>
                    <input
                      type="date"
                      value={custom.to || board.window.to || ''}
                      min={custom.from || board.coverage.start || undefined}
                      max={board.coverage.end ?? undefined}
                      onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                    />
                  </label>
                  <button
                    type="button"
                    className={styles.customApply}
                    disabled={!custom.from || !custom.to}
                    onClick={() => {
                      setPreset(-1);
                      setPickerOpen(false);
                    }}
                  >
                    Apply
                  </button>
                  <p className={styles.customNote}>
                    Stored: {board.coverage.start} to {board.coverage.end}
                  </p>
                </div>
              )}
            </span>
          </div>
        </header>

        <div className={styles.filters}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Game Mode</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as CardMode)}>
              {MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Elixir Cost</span>
            <select value={elixir} onChange={(e) => setElixir(e.target.value)}>
              <option value="all">All</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Rarity</span>
            <select value={rarity} onChange={(e) => setRarity(e.target.value)}>
              <option value="all">All</option>
              {RARITIES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Sort by</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={!hideUnplayed}
              onChange={(e) => setHideUnplayed(!e.target.checked)}
            />
            Show cards they never played
          </label>

          <button type="button" className={styles.reset} disabled={!dirty} onClick={reset}>
            {ICONS.reset}
            Reset filters
          </button>
        </div>

        <div className={styles.tabs} role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`${styles.tab} ${tab === t.id ? styles.tabOn : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Under the tabs, per the brief: type a card name when scanning the
            grid is slower than saying what you want. */}
        <div className={styles.searchRow}>
          <span className={styles.searchIcon}>{ICONS.search}</span>
          <input
            className={styles.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search card…"
            aria-label="Search card"
            spellCheck={false}
          />
          {query && (
            <button type="button" className={styles.searchClear} onClick={() => setQuery('')}>
              Clear
            </button>
          )}
          <span className={styles.count}>
            {nf.format(rows.length)} {rows.length === 1 ? 'card' : 'cards'}
          </span>
        </div>

        {rows.length === 0 ? (
          <p className={styles.empty}>No card matches these filters.</p>
        ) : (
          <>
            <div className={styles.grid}>
              {rows.slice(0, shown).map((r) => (
                <CardTile key={r.key} row={r} useScale={useScale} art={art} />
              ))}
            </div>
            {rows.length > shown && (
              <button type="button" className={styles.more} onClick={() => setShown((n) => n + PAGE)}>
                Show {Math.min(PAGE, rows.length - shown)} more · {rows.length - shown} left
              </button>
            )}
          </>
        )}

        {/* THE FOOTER IS NOW ONLY THE PER-FORM NOTE, and it renders only on the
            two tabs that need it. The basis sentence that used to lead it — the
            evidence floor, how many cards cleared it, and which window movement
            was measured against — was removed on request along with the same
            kind of blurb on four other screens.

            This half stays because it is not a basis note: it says the figures
            above belong to the EVOLVED card rather than the card, which changes
            what the number means rather than explaining where it came from. */}
        {art && (
        <footer className={styles.foot}>
          {/* Said out loud on the two tabs where it matters: the art is the
              special form, but the FIGURES are the card's whole record. There
              is no separate win rate for an evolved Knight — the stored row
              records which cards were fielded specially, not a per-form
              result — and implying otherwise would be the more useful claim
              and the false one. */}
            <>
              <strong>These figures are the {art} form&rsquo;s own</strong>, not the
              card&rsquo;s — an {art === 'hero' ? 'Hero' : 'evolved'} Knight is scored
              separately from a plain one. Hover a card for the same card&rsquo;s plain
              record. They come from the{' '}
              {nf.format(board.formCoverage.battles)} battles in this window whose payload
              recorded which form was fielded
              {board.formCoverage.from
                ? ` (${shortDay(board.formCoverage.from)} – ${shortDay(board.formCoverage.to)})`
                : ''}
              , {board.formCoverage.share.toFixed(0)}% of the {nf.format(totals.battles)} here —
              the only battles where the two forms can be told apart at all. The use rate is a
              share of those, so it is not comparable with the other tabs&rsquo;.
            </>
        </footer>
        )}
      </section>
    </div>
  );
}
