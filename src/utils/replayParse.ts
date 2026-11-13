/**
 * THE REPLAY BOARD'S READER: a saved RoyaleAPI replay page -> one battle, every
 * card play in it, where it landed and when.
 *
 * WHERE THE DATA COMES FROM. RoyaleAPI's replay page
 * (`royaleapi.com/replay?tag=...&team_tags=...&opponent_tags=...`) draws a
 * timeline and a map once the replay has loaded. Each play is in it twice:
 *
 *   - `.replay_card` on the timeline: `data-t` (the moment, 20 to a second),
 *     `data-s` (`t` = the player the page is about, `o` = their opponent),
 *     `data-card` (the card's key, `-ev1` / `-hero` when that form was played),
 *     `data-ability="1"` for a champion's or hero's ability press;
 *   - `.marker` on the map: the same `data-t` / `data-s`, the card as
 *     `data-c`, and the spot as `data-x` 0..18000 / `data-y` 0..32000 (the
 *     arena is 18 x 32 tiles, a thousand to the tile). `data-i` is the page's
 *     own display flip.
 *
 * Around them: the two `.team-segment` blocks (name, `copyDeck` link, each card
 * with its level and form, the tower troop), a `.hp-both-popup` holding both
 * sides' tower HP at the end, and the replay URL with both crown counts.
 *
 * THE STRUCTURE IS THE ONE CLASHBACK (github.com/ak1NaN/Clashback) READS. That
 * project re-runs these plays inside Supercell's own game engine on a Mac; none
 * of its code is used here (it carries no licence) and none of the game engine
 * could be (it is Supercell's). What is shared is the fact of where RoyaleAPI
 * puts the data, which is what a reader of the same page has to know.
 *
 * NOTHING HERE TOUCHES THE NETWORK. The admin saves the page in their own
 * browser and drops the file on the board; the file is read on their machine.
 * RoyaleAPI refuses automated reads, and the board does not try.
 *
 * THE PLAYER THE PAGE IS ABOUT IS ALWAYS BLUE, AT THE BOTTOM. The raw
 * coordinates keep the arena as the game had it, which can put that player at
 * the top. Which way round it is gets decided from the plays themselves —
 * a troop can only be dropped on your own half, so the side whose troops sit
 * low is the bottom — with the page's own flag (`data-i`) as the fallback.
 */

import { CARDS, CARDS_BY_KEY } from '../data/cards';
import { decodeEntities, findAll, hasClass, parseHtml, textOf, unwrapSavedPage, type HtmlNode } from './htmlScan';

export const TICKS_PER_SECOND = 20;
export const ARENA_W = 18;
export const ARENA_H = 32;
/** Raw units to the tile. */
const UNIT = 1000;

export type ReplaySide = 'blue' | 'red';
export type ReplayForm = 'evolution' | 'hero' | null;

export interface ReplayDeckCard {
  /** Our catalogue key (also RoyaleAPI's). */
  key: string;
  level: number | null;
  form: ReplayForm;
}

export interface ReplayTowers {
  king: number;
  /** The page does not say which princess tower is which, so neither does this. */
  princess: [number, number];
  total: number;
}

export interface ReplayPlayer {
  side: ReplaySide;
  name: string;
  tag: string | null;
  crowns: number | null;
  /** Up to eight, in the page's order. */
  deck: ReplayDeckCard[];
  tower: { key: string; level: number | null } | null;
  /** Tower HP when the battle ended, when the page carried it. */
  towersLeft: ReplayTowers | null;
}

export interface ReplayEvent {
  /** Position in time order, 0-based. */
  n: number;
  tick: number;
  /** Seconds from the start of the battle. */
  t: number;
  side: ReplaySide;
  kind: 'play' | 'ability';
  /** Catalogue key of the card (the base card, the form is separate). */
  key: string;
  form: ReplayForm;
  /** Tiles, with blue at the bottom (y 0) — null for an ability. */
  x: number | null;
  y: number | null;
  /** Elixir the play cost, when the catalogue knows it. Null for abilities. */
  elixir: number | null;
}

export interface Replay {
  v: 1;
  id: string;
  battleTag: string | null;
  url: string | null;
  /** Unix seconds of the battle, when the page carried it. */
  battleTime: number | null;
  modeId: number | null;
  players: Record<ReplaySide, ReplayPlayer>;
  events: ReplayEvent[];
  /** Seconds: the last play plus a short tail, so the end can be watched. */
  duration: number;
  /** True when the raw arena was turned round to put blue at the bottom. */
  flipped: boolean;
}

export type ReplayProblem = 'empty' | 'not_replay' | 'no_plays';

export class ReplayParseError extends Error {
  reason: ReplayProblem;
  constructor(reason: ReplayProblem) {
    super(REPLAY_PROBLEM_TEXT[reason]);
    this.reason = reason;
  }
}

/** One line each, said to the admin who dropped the file. */
export const REPLAY_PROBLEM_TEXT: Record<ReplayProblem, string> = {
  empty: 'That file is empty.',
  not_replay: 'That is not a RoyaleAPI replay page.',
  no_plays:
    'The page was saved before its replay loaded. Open the replay, wait for the card timeline, then save it again.',
};

/* ── Cards ──────────────────────────────────────────────────────────────── */

const BY_ID = new Map(CARDS.map((c) => [c.id, c]));
const NORM = new Map(CARDS.map((c) => [norm(c.key), c.key]));
for (const c of CARDS) if (!NORM.has(norm(c.name))) NORM.set(norm(c.name), c.key);

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** `hog-rider-ev1` -> { key: 'hog-rider', form: 'evolution' }. */
export function splitSlug(slug: string): { key: string; form: ReplayForm } {
  const s = slug.trim().toLowerCase();
  let base = s;
  let form: ReplayForm = null;
  const evo = /-ev\d+$/.exec(s);
  if (evo) {
    base = s.slice(0, evo.index);
    form = 'evolution';
  } else if (s.endsWith('-hero')) {
    base = s.slice(0, -'-hero'.length);
    form = 'hero';
  }
  const key = CARDS_BY_KEY.has(base) ? base : NORM.get(norm(base)) ?? base;
  return { key, form };
}

/** Cards a player may drop on the far half: spells, and the two that dig. */
function landsAnywhere(key: string): boolean {
  const card = CARDS_BY_KEY.get(key);
  if (!card) return true; // unknown: do not let it decide which side is which
  return card.type === 'Spell' || key === 'miner' || key === 'goblin-drill';
}

/* ── Small readers ──────────────────────────────────────────────────────── */

function int(v: string | undefined): number | null {
  if (v == null || v === '' || v === 'None' || v === 'null') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function cleanTag(t: string | null | undefined): string | null {
  if (!t) return null;
  const s = t.replace(/^%23/i, '').replace(/^#/, '').toUpperCase();
  return /^[0289PYLQGRJCUV]{3,14}$/.test(s) ? `#${s}` : null;
}

interface ReplayUrl {
  url: string;
  tag: string | null;
  team: string | null;
  opponent: string | null;
  teamCrowns: number | null;
  opponentCrowns: number | null;
}

function readReplayUrl(candidate: string): ReplayUrl | null {
  let u: URL;
  try {
    u = new URL(decodeEntities(candidate.trim()));
  } catch {
    return null;
  }
  if (!/(^|\.)royaleapi\.com$/i.test(u.hostname) || !u.pathname.startsWith('/replay')) return null;
  const q = u.searchParams;
  const crowns = (k: string) => {
    const v = q.get(k);
    return v != null && /^[0-3]$/.test(v) ? Number(v) : null;
  };
  return {
    url: `https://royaleapi.com/replay?${q.toString()}`,
    tag: q.get('tag'),
    team: cleanTag(q.get('team_tags')),
    opponent: cleanTag(q.get('opponent_tags')),
    teamCrowns: crowns('team_crowns'),
    opponentCrowns: crowns('opponent_crowns'),
  };
}

function findReplayUrl(html: string, root: HtmlNode): ReplayUrl | null {
  // Chrome's "saved from url" comment is the most reliable: it is the URL the
  // page was saved from, written before anything else.
  const saved = /<!--\s*saved from url=\(\d+\)(\S+?)\s*-->/i.exec(html.slice(0, 2000));
  if (saved) {
    const r = readReplayUrl(saved[1]);
    if (r) return r;
  }
  const metas = findAll(
    root,
    (n) => n.attrs.rel === 'canonical' || n.attrs.property === 'og:url' || n.attrs.name === 'twitter:url',
  );
  for (const n of metas) {
    const r = readReplayUrl(n.attrs.href ?? n.attrs.content ?? '');
    if (r) return r;
  }
  const loose = /https?:\/\/(?:www\.)?royaleapi\.com\/replay\?[^"'<>\s]+/i.exec(html);
  return loose ? readReplayUrl(loose[0]) : null;
}

/* ── Players ────────────────────────────────────────────────────────────── */

function readDeck(segment: HtmlNode): ReplayDeckCard[] {
  const deck: ReplayDeckCard[] = [];
  const seen = new Set<string>();
  for (const block of findAll(segment, (n) => hasClass(n, 'deck_card__four_wide'))) {
    const img = findAll(block, (n) => hasClass(n, 'deck_card') || 'data-card-key' in n.attrs)[0];
    const slug = img?.attrs['data-card-key'];
    if (!slug) continue;
    const { key, form } = splitSlug(slug);
    if (seen.has(key)) continue;
    seen.add(key);
    const levelNode = findAll(block, (n) => hasClass(n, 'card-level'))[0];
    const level = levelNode ? int(/\d+/.exec(textOf(levelNode))?.[0]) : null;
    deck.push({ key, level, form });
  }
  if (deck.length) return deck.slice(0, 8);
  // No card blocks: the copyDeck link carries the eight official ids.
  const link = findAll(segment, (n) => (n.attrs.href ?? '').includes('copyDeck'))[0];
  const ids = /deck=([0-9;%3Bb]+)/i.exec(link?.attrs.href ?? '')?.[1];
  if (ids) {
    for (const id of decodeURIComponent(ids).split(';')) {
      const card = BY_ID.get(Number(id));
      if (card && !seen.has(card.key)) {
        seen.add(card.key);
        deck.push({ key: card.key, level: null, form: null });
      }
    }
  }
  return deck.slice(0, 8);
}

const TOWER_TROOPS = ['tower-princess', 'cannoneer', 'dagger-duchess', 'royal-chef'];

function readTower(segment: HtmlNode): ReplayPlayer['tower'] {
  for (const n of findAll(segment, (x) => (x.attrs.href ?? '').includes('/card/'))) {
    const href = n.attrs.href ?? '';
    const key = TOWER_TROOPS.find((k) => href.includes(`/card/${k}`));
    if (!key) continue;
    const label = `${textOf(n)} ${findAll(n, () => true).map((x) => x.attrs.alt ?? '').join(' ')}`;
    const level = int(/(?:Lvl|Level)\s*(\d+)/i.exec(label)?.[1]);
    return { key, level };
  }
  return null;
}

function readName(segment: HtmlNode, fallback: string): { name: string; tag: string | null } {
  const node = findAll(segment, (n) => hasClass(n, 'player_name_header'))[0];
  if (!node) return { name: fallback, tag: null };
  const tag = cleanTag(/\/player\/([^/?#"]+)/.exec(node.attrs.href ?? '')?.[1]);
  const name = textOf(node) || fallback;
  return { name, tag };
}

function readTowersLeft(root: HtmlNode): Record<'team' | 'oppo', ReplayTowers | null> {
  const node = findAll(root, (n) => hasClass(n, 'hp-both-popup'))[0];
  const side = (s: 'team' | 'oppo'): ReplayTowers | null => {
    if (!node) return null;
    const king = int(node.attrs[`data-${s}-king`]);
    const p0 = int(node.attrs[`data-${s}-princess0`]);
    const p1 = int(node.attrs[`data-${s}-princess1`]);
    const total = int(node.attrs[`data-${s}-total`]);
    if (king == null || p0 == null || p1 == null) return null;
    return { king, princess: [p0, p1], total: total ?? king + p0 + p1 };
  };
  return { team: side('team'), oppo: side('oppo') };
}

/* ── Events ─────────────────────────────────────────────────────────────── */

interface RawEvent {
  tick: number;
  side: ReplaySide;
  kind: 'play' | 'ability';
  slug: string;
  x: number | null;
  y: number | null;
  flag: number | null;
}

function sideOf(s: string | undefined): ReplaySide | null {
  if (s === 't') return 'blue';
  if (s === 'o') return 'red';
  return null;
}

function readEvents(root: HtmlNode): RawEvent[] {
  const timeline = findAll(root, (n) => hasClass(n, 'replay_card') && 'data-t' in n.attrs);
  const markers = findAll(root, (n) => hasClass(n, 'marker') && 'data-t' in n.attrs && 'data-x' in n.attrs);

  // Markers waiting for their timeline entry, by side + moment + card. A card
  // played twice in one tick by one side is legal (it never is in practice),
  // hence a queue rather than a single slot.
  const waiting = new Map<string, HtmlNode[]>();
  const keyOf = (s: string, t: string, card: string) => `${s}|${t}|${card}`;
  for (const m of markers) {
    const card = (m.attrs['data-c'] ?? '').toLowerCase();
    for (const k of [keyOf(m.attrs['data-s'], m.attrs['data-t'], card), keyOf(m.attrs['data-s'], m.attrs['data-t'], splitSlug(card).key)]) {
      const q = waiting.get(k) ?? [];
      q.push(m);
      waiting.set(k, q);
    }
  }
  const used = new Set<HtmlNode>();
  const take = (s: string, t: string, card: string): HtmlNode | null => {
    for (const k of [keyOf(s, t, card), keyOf(s, t, splitSlug(card).key)]) {
      const q = waiting.get(k);
      while (q && q.length) {
        const m = q.shift()!;
        if (!used.has(m)) {
          used.add(m);
          return m;
        }
      }
    }
    return null;
  };

  const out: RawEvent[] = [];
  for (const item of timeline) {
    const side = sideOf(item.attrs['data-s']);
    const tick = int(item.attrs['data-t']);
    const slug = (item.attrs['data-card'] ?? '').toLowerCase();
    if (!side || tick == null || !slug) continue;
    const ability = item.attrs['data-ability'] === '1';
    const marker = take(item.attrs['data-s'], item.attrs['data-t'], slug);
    out.push({
      tick,
      side,
      kind: ability ? 'ability' : 'play',
      slug,
      x: marker ? int(marker.attrs['data-x']) : null,
      y: marker ? int(marker.attrs['data-y']) : null,
      flag: marker ? int(marker.attrs['data-i']) : null,
    });
  }
  // A map marker with no timeline entry is still a play the page recorded.
  for (const m of markers) {
    if (used.has(m)) continue;
    const side = sideOf(m.attrs['data-s']);
    const tick = int(m.attrs['data-t']);
    const slug = (m.attrs['data-c'] ?? '').toLowerCase();
    if (!side || tick == null || !slug) continue;
    used.add(m);
    out.push({ tick, side, kind: 'play', slug, x: int(m.attrs['data-x']), y: int(m.attrs['data-y']), flag: int(m.attrs['data-i']) });
  }
  out.sort((a, b) => a.tick - b.tick || (a.side === b.side ? 0 : a.side === 'blue' ? -1 : 1));
  return out;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Should the raw arena be turned round to put blue at the bottom?
 *
 * Troops and buildings land on their owner's half, so the side whose such
 * plays sit lower is the bottom side. Spells, the Miner and the Goblin Drill
 * may land anywhere and do not vote. Only when the plays cannot say does the
 * page's own display flag decide: it marks a page that turned its map round
 * so its player sat at the bottom, i.e. one whose player is at the top raw.
 */
export function shouldFlip(events: RawEvent[]): boolean {
  const lows: Record<ReplaySide, number[]> = { blue: [], red: [] };
  for (const e of events) {
    if (e.kind !== 'play' || e.y == null) continue;
    if (landsAnywhere(splitSlug(e.slug).key)) continue;
    lows[e.side].push(e.y);
  }
  const b = median(lows.blue);
  const r = median(lows.red);
  const mid = (ARENA_H * UNIT) / 2;
  if (b != null && r != null && b !== r) return b > r;
  if (b != null && b !== mid) return b > mid;
  if (r != null && r !== mid) return r < mid;
  const flags = events.map((e) => e.flag).filter((f): f is number => f != null);
  if (flags.length) return flags.filter((f) => f === 1).length * 2 > flags.length;
  return false;
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/* ── The whole page ─────────────────────────────────────────────────────── */

export function parseReplay(text: string): Replay {
  if (!text || !text.trim()) throw new ReplayParseError('empty');
  const html = unwrapSavedPage(text);
  const root = parseHtml(html);
  const raw = readEvents(root);
  const looksLikeReplay =
    raw.length > 0 ||
    /royaleapi/i.test(html.slice(0, 200_000)) &&
      (findAll(root, (n) => hasClass(n, 'team-segment')).length > 0 || /\/replay\?/.test(html));
  if (!looksLikeReplay) throw new ReplayParseError('not_replay');
  if (!raw.some((e) => e.kind === 'play')) throw new ReplayParseError('no_plays');

  const link = findReplayUrl(html, root);
  const segments = findAll(root, (n) => hasClass(n, 'team-segment'));
  const hp = readTowersLeft(root);

  const player = (side: ReplaySide): ReplayPlayer => {
    const seg = segments[side === 'blue' ? 0 : 1];
    const fallbackName = side === 'blue' ? 'Blue' : 'Red';
    const { name, tag } = seg ? readName(seg, fallbackName) : { name: fallbackName, tag: null };
    const urlTag = side === 'blue' ? link?.team ?? null : link?.opponent ?? null;
    let deck = seg ? readDeck(seg) : [];
    // A page with no deck block still shows what was played: build the deck
    // from the plays, so the board can draw something in its place.
    if (deck.length < 8) {
      const have = new Set(deck.map((c) => c.key));
      for (const e of raw) {
        if (e.side !== side || e.kind !== 'play' || deck.length >= 8) continue;
        const { key, form } = splitSlug(e.slug);
        if (!have.has(key)) {
          have.add(key);
          deck = [...deck, { key, level: null, form }];
        }
      }
    }
    return {
      side,
      name,
      tag: tag ?? urlTag,
      crowns: side === 'blue' ? link?.teamCrowns ?? null : link?.opponentCrowns ?? null,
      deck,
      tower: seg ? readTower(seg) : null,
      towersLeft: side === 'blue' ? hp.team : hp.oppo,
    };
  };
  const players = { blue: player('blue'), red: player('red') };

  const flipped = shouldFlip(raw);
  const lastCost: Record<ReplaySide, number | null> = { blue: null, red: null };
  const events: ReplayEvent[] = raw.map((e, n) => {
    const { key, form } = splitSlug(e.slug);
    let x = e.x != null ? Math.min(ARENA_W, Math.max(0, e.x / UNIT)) : null;
    let y = e.y != null ? Math.min(ARENA_H, Math.max(0, e.y / UNIT)) : null;
    if (flipped && x != null && y != null) {
      x = ARENA_W - x;
      y = ARENA_H - y;
    }
    let elixir: number | null = null;
    if (e.kind === 'play') {
      // The Mirror costs one more than the card it copies — the last card its
      // player played.
      if (key === 'mirror') elixir = lastCost[e.side] != null ? Math.min(10, lastCost[e.side]! + 1) : null;
      else elixir = CARDS_BY_KEY.get(key)?.elixir ?? null;
      if (key !== 'mirror') lastCost[e.side] = elixir;
    }
    // A play keeps the form its deck slot was played in, when the slug did not
    // say: the deck block knows which cards are fielded as evolution or hero.
    const deckForm = players[e.side].deck.find((c) => c.key === key)?.form ?? null;
    return {
      n,
      tick: e.tick,
      t: e.tick / TICKS_PER_SECOND,
      side: e.side,
      kind: e.kind,
      key,
      form: form ?? (e.kind === 'play' ? null : deckForm),
      x: e.kind === 'play' ? x : null,
      y: e.kind === 'play' ? y : null,
      elixir,
    };
  });

  const modeNode = findAll(root, (n) => 'data-game-mode-id' in n.attrs)[0];
  const lastT = events.length ? events[events.length - 1].t : 0;
  const id = fnv(
    `${link?.tag ?? ''}|${players.blue.tag ?? players.blue.name}|${players.red.tag ?? players.red.name}|${events
      .map((e) => `${e.tick}${e.side[0]}${e.key}`)
      .join(',')}`,
  );

  return {
    v: 1,
    id,
    battleTag: link?.tag ?? null,
    url: link?.url ?? null,
    battleTime: modeNode ? int(modeNode.attrs['data-index']) : null,
    modeId: modeNode ? int(modeNode.attrs['data-game-mode-id']) : null,
    players,
    events,
    duration: Math.max(10, Math.ceil(lastT + 3)),
    flipped,
  };
}

/* ── Fitting a replay to a battle row ───────────────────────────────────── */

/** Supercell's stamp `20260824T104652.000Z` -> unix seconds, or null. */
export function stampToUnix(stamp: string | null | undefined): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(stamp ?? '');
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s) / 1000;
}

const OTHER: Record<ReplaySide, ReplaySide> = { blue: 'red', red: 'blue' };

/**
 * The same replay drawn from `tag`'s seat: that player blue, at the bottom.
 *
 * A RoyaleAPI page is about whichever player it was opened from, so a battle
 * saved from the opponent's page arrives the other way round from the Recent
 * Battles row it is watched from. Turning it is a swap of the two players and
 * a half turn of the arena — the plays themselves do not change.
 */
export function seenBy(replay: Replay, tag: string | null | undefined): Replay {
  const want = tag ? `#${tag.replace(/^#/, '').toUpperCase()}` : null;
  if (!want || replay.players.blue.tag === want || replay.players.red.tag !== want) return replay;
  return {
    ...replay,
    flipped: !replay.flipped,
    players: {
      blue: { ...replay.players.red, side: 'blue' },
      red: { ...replay.players.blue, side: 'red' },
    },
    events: replay.events.map((e) => ({
      ...e,
      side: OTHER[e.side],
      x: e.x == null ? null : ARENA_W - e.x,
      y: e.y == null ? null : ARENA_H - e.y,
    })),
  };
}

/** The two players' tags, upper-case with '#', in no particular order. */
export function replayTags(replay: Replay): [string | null, string | null] {
  return [replay.players.blue.tag, replay.players.red.tag];
}
