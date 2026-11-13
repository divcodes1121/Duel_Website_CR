import { afterEach, describe, expect, it, beforeEach, vi } from 'vitest';

/* Storage is stubbed per test and ALWAYS put back: the suite runs in one
   process, and a stub left behind broke the store tests in other files. */
afterEach(() => {
  vi.unstubAllGlobals();
});
import { readFileSync } from 'node:fs';
import { decodeEntities, parseHtml, findAll, hasClass, unwrapSavedPage } from '../src/utils/htmlScan';
import { ReplayParseError, parseReplay, seenBy, shouldFlip, splitSlug, stampToUnix } from '../src/utils/replayParse';
import { cycleAt, clock, elixirAt, elixirSeries, summarise, zoneOf, zoneLabel } from '../src/utils/replayModel';

/* The Replay Board reads a saved RoyaleAPI replay page. These pages are built
   here from the structure that page has (see src/utils/replayParse.ts) with
   INVENTED players and tags — the repo is public. */

interface Play {
  t: number; // ticks
  s: 't' | 'o';
  c: string;
  x?: number;
  y?: number;
  ability?: boolean;
  noMarker?: boolean;
  markerCard?: string;
  flag?: 0 | 1;
}

const BLUE_DECK = ['hog-rider', 'musketeer-ev1', 'ice-golem', 'ice-spirit', 'skeletons', 'cannon', 'fireball', 'the-log'];
const RED_DECK = ['golem', 'night-witch', 'baby-dragon', 'lumberjack', 'tornado', 'lightning', 'barbarian-barrel', 'little-prince'];

function segment(name: string, tag: string, deck: string[], level = 14): string {
  const cards = deck
    .map(
      (k) => `<div class="deck_card__four_wide"><img class="deck_card ui image" data-card-key="${k}" src="x.png" alt="${k}"><div class="card-level">Lvl ${level}</div></div>`,
    )
    .join('\n');
  return `<div class="team-segment">
  <a class="player_name_header" href="/player/${tag}">${name}</a>
  <a href="https://link.clashroyale.com/en/?clashroyale://copyDeck?deck=26000021;26000014">Copy</a>
  ${cards}
  <a href="/card/tower-princess"><img alt="Tower Princess"> Lvl 15</a>
</div>`;
}

function page(plays: Play[], opts: { hp?: boolean; nameBlue?: string } = {}): string {
  const timeline = plays
    .filter((p) => !p.noMarker || true)
    .map((p) => `<div class="replay_card" data-t="${p.t}" data-s="${p.s}" data-card="${p.c}"${p.ability ? ' data-ability="1"' : ''}></div>`)
    .join('\n');
  const markers = plays
    .filter((p) => !p.ability && !p.noMarker)
    .map(
      (p) =>
        `<div class="marker" data-t="${p.t}" data-s="${p.s}" data-c="${p.markerCard ?? p.c}" data-x="${p.x ?? 9000}" data-y="${p.y ?? 8000}" data-i="${p.flag ?? 0}"></div>`,
    )
    .join('\n');
  return `<!-- saved from url=(0099)https://royaleapi.com/replay?tag=ABC123&team_tags=PQ8RJ2Y0&opponent_tags=9CVL2URG&team_crowns=1&opponent_crowns=0 -->
<!DOCTYPE html><html><head><title>Replay &amp; more</title>
<link rel="canonical" href="https://royaleapi.com/replay?tag=ABC123&amp;team_tags=PQ8RJ2Y0&amp;opponent_tags=9CVL2URG&amp;team_crowns=1&amp;opponent_crowns=0">
<script>var fake = '<div class="replay_card" data-t="1" data-s="t" data-card="golem"></div>';</script>
<style>.marker { color: red }</style></head><body>
${segment(opts.nameBlue ?? 'Ember &amp; Vale', 'PQ8RJ2Y0', BLUE_DECK)}
${segment('Sora Kite', '9CVL2URG', RED_DECK, 13)}
<div class="rules" data-game-mode-id="72000201" data-index="1762992000"></div>
${opts.hp === false ? '' : '<div class="hp-both-popup" data-team-king="4824" data-team-princess0="3052" data-team-princess1="1820" data-team-total="9696" data-oppo-king="4824" data-oppo-princess0="0" data-oppo-princess1="2290" data-oppo-total="7114"></div>'}
<div class="timeline">${timeline}</div>
<div class="map">${markers}</div>
</body></html>`;
}

/* Blue plays low (y < 16000) and red high: the raw arena already has blue at
   the bottom. */
const PLAYS: Play[] = [
  { t: 140, s: 't', c: 'ice-golem', x: 3500, y: 13500 },
  { t: 150, s: 't', c: 'hog-rider', x: 3500, y: 14500 },
  { t: 200, s: 'o', c: 'golem', x: 7000, y: 31000 },
  { t: 260, s: 't', c: 'ice-spirit', x: 9000, y: 9000 },
  { t: 300, s: 'o', c: 'night-witch', x: 7500, y: 29000 },
  { t: 320, s: 't', c: 'musketeer-ev1', x: 3500, y: 9500 },
  { t: 420, s: 't', c: 'cannon', x: 9000, y: 10000 },
  { t: 480, s: 'o', c: 'little-prince', x: 14500, y: 19000 },
  { t: 520, s: 'o', c: 'little-prince', ability: true },
  { t: 600, s: 't', c: 'fireball', x: 14500, y: 25500 },
  { t: 640, s: 'o', c: 'tornado', x: 9000, y: 10000 },
  { t: 700, s: 'o', c: 'baby-dragon', x: 9000, y: 28000 },
  { t: 760, s: 'o', c: 'lumberjack', x: 3500, y: 18500 },
  { t: 800, s: 'o', c: 'lightning', x: 3500, y: 6500 },
];

describe('htmlScan', () => {
  it('decodes entities, named and numeric', () => {
    expect(decodeEntities('A &amp; B &#39;x&#x27; &lt;3 &nbsp;')).toBe("A & B 'x' <3  ");
    expect(decodeEntities('&bogus; &#xZZ;')).toBe('&bogus; &#xZZ;');
  });

  it('never reads markup inside a script, and keeps nesting', () => {
    const root = parseHtml('<div class="a"><script>"<div class=\'b\'></div>"</script><p class="b">x<br>y</p></div>');
    expect(findAll(root, (n) => hasClass(n, 'b')).map((n) => n.tag)).toEqual(['p']);
    const a = findAll(root, (n) => hasClass(n, 'a'))[0];
    expect(a.children.map((c) => c.tag)).toEqual(['script', 'p']);
  });

  it('forgives a stray end tag and reads bare and unquoted attributes', () => {
    const root = parseHtml('<div data-x=5 hidden></span><img src=a.png></div>');
    const div = findAll(root, (n) => n.tag === 'div')[0];
    expect(div.attrs['data-x']).toBe('5');
    expect('hidden' in div.attrs).toBe(true);
    expect(div.children.map((c) => c.tag)).toEqual(['img']);
  });

  it("unwraps Chrome's single-file (MHTML, quoted-printable) save", () => {
    const html = page(PLAYS);
    const qp = html
      .replace(/=/g, '=3D')
      .replace(/(.{70})/g, '$1=\n'); // soft line breaks every 70 characters
    const mhtml = [
      'From: <Saved by Blink>',
      'Snapshot-Content-Location: https://royaleapi.com/replay?tag=ABC123',
      'MIME-Version: 1.0',
      'Content-Type: multipart/related;',
      '\ttype="text/html";',
      '\tboundary="----MultipartBoundary--abc----"',
      '',
      '------MultipartBoundary--abc----',
      'Content-Type: text/html',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      qp,
      '------MultipartBoundary--abc------',
    ].join('\r\n');
    expect(unwrapSavedPage(mhtml)).toBe(html);
    expect(parseReplay(mhtml).events.length).toBe(parseReplay(html).events.length);
  });
});

describe('parseReplay', () => {
  const r = parseReplay(page(PLAYS));

  it('reads both players: name (entities decoded), tag, crowns, tower troop', () => {
    expect(r.players.blue.name).toBe('Ember & Vale');
    expect(r.players.blue.tag).toBe('#PQ8RJ2Y0');
    expect(r.players.red.tag).toBe('#9CVL2URG');
    expect(r.players.blue.crowns).toBe(1);
    expect(r.players.red.crowns).toBe(0);
    expect(r.players.blue.tower).toEqual({ key: 'tower-princess', level: 15 });
    expect(r.battleTag).toBe('ABC123');
    expect(r.modeId).toBe(72000201);
    expect(r.battleTime).toBe(1762992000);
  });

  it('reads each deck in page order, with levels and forms', () => {
    expect(r.players.blue.deck.map((c) => c.key)).toEqual([
      'hog-rider', 'musketeer', 'ice-golem', 'ice-spirit', 'skeletons', 'cannon', 'fireball', 'the-log',
    ]);
    expect(r.players.blue.deck[1].form).toBe('evolution');
    expect(r.players.blue.deck.every((c) => c.level === 14)).toBe(true);
    expect(r.players.red.deck.every((c) => c.level === 13)).toBe(true);
  });

  it('reads tower HP at the end, per side', () => {
    expect(r.players.blue.towersLeft).toEqual({ king: 4824, princess: [3052, 1820], total: 9696 });
    expect(r.players.red.towersLeft?.princess).toEqual([0, 2290]);
  });

  it('every play in time order, 20 ticks to the second, positions in tiles', () => {
    expect(r.events.map((e) => e.tick)).toEqual(PLAYS.map((p) => p.t));
    expect(r.events[0]).toMatchObject({ t: 7, side: 'blue', kind: 'play', key: 'ice-golem', x: 3.5, y: 13.5, elixir: 2 });
    expect(r.events[5]).toMatchObject({ key: 'musketeer', form: 'evolution' });
    expect(r.flipped).toBe(false);
    expect(r.duration).toBe(Math.ceil(800 / 20 + 3));
  });

  it("an ability press has no spot and no cost, and takes the card's form from the deck", () => {
    const ability = r.events.find((e) => e.kind === 'ability')!;
    expect(ability).toMatchObject({ key: 'little-prince', x: null, y: null, elixir: null, side: 'red' });
  });

  it('a page whose player sits at the top raw is turned round', () => {
    const turned = PLAYS.map((p) =>
      p.ability ? p : { ...p, x: 18000 - (p.x ?? 9000), y: 32000 - (p.y ?? 8000), flag: 1 as const },
    );
    const t = parseReplay(page(turned));
    expect(t.flipped).toBe(true);
    // Same positions as the page that was already the right way round.
    expect(t.events.map((e) => [e.x, e.y])).toEqual(r.events.map((e) => [e.x, e.y]));
  });

  it('spells and diggers never decide which side is the bottom', () => {
    // Only spells, all landing on the far half: no vote, the page's flag decides.
    const spells: Play[] = [
      { t: 100, s: 't', c: 'fireball', x: 3500, y: 25000, flag: 0 },
      { t: 200, s: 'o', c: 'lightning', x: 3500, y: 6000, flag: 0 },
    ];
    expect(parseReplay(page(spells)).flipped).toBe(false);
    expect(
      shouldFlip([
        { tick: 1, side: 'blue', kind: 'play', slug: 'miner', x: 0, y: 30000, flag: null },
        { tick: 2, side: 'blue', kind: 'play', slug: 'goblin-drill', x: 0, y: 30000, flag: null },
      ]),
    ).toBe(false);
  });

  it('a map marker missing from the timeline is still a play; a form suffix still finds its marker', () => {
    const plays: Play[] = [
      { t: 100, s: 't', c: 'musketeer-ev1', markerCard: 'musketeer', x: 3500, y: 9000 },
      { t: 200, s: 't', c: 'cannon', x: 9000, y: 10000 },
    ];
    const html = page(plays).replace('<div class="replay_card" data-t="200" data-s="t" data-card="cannon"></div>', '');
    const p = parseReplay(html);
    expect(p.events.map((e) => [e.key, e.x])).toEqual([
      ['musketeer', 3.5],
      ['cannon', 9],
    ]);
  });

  it('the Mirror costs one more than the card before it', () => {
    const p = parseReplay(
      page([
        { t: 100, s: 't', c: 'hog-rider', x: 3500, y: 14000 },
        { t: 120, s: 't', c: 'mirror', x: 3500, y: 14000 },
      ]),
    );
    expect(p.events.map((e) => e.elixir)).toEqual([4, 5]);
  });

  it('says why a file cannot be read', () => {
    const reason = (text: string) => {
      try {
        parseReplay(text);
        return 'parsed';
      } catch (e) {
        return e instanceof ReplayParseError ? e.reason : 'other';
      }
    };
    expect(reason('')).toBe('empty');
    expect(reason('<html><body><p>Hello</p></body></html>')).toBe('not_replay');
    expect(reason(page([]))).toBe('no_plays');
  });

  it('splitSlug knows the evolution and hero suffixes', () => {
    expect(splitSlug('knight-ev1')).toEqual({ key: 'knight', form: 'evolution' });
    expect(splitSlug('knight-hero')).toEqual({ key: 'knight', form: 'hero' });
    expect(splitSlug('the-log')).toEqual({ key: 'the-log', form: null });
  });
});

describe('the card cycle', () => {
  const r = parseReplay(page(PLAYS));

  it('before four plays, only what was played is known to be out of hand', () => {
    const c = cycleAt(r, 'blue', 14); // two plays so far
    expect(c.exact).toBe(false);
    expect(c.spots['ice-golem']).toBe('queue');
    expect(c.spots['hog-rider']).toBe('queue');
    expect(c.spots['cannon']).toBe('maybe');
  });

  it('after four plays the hand is exact: the queue is the last four, oldest next', () => {
    const c = cycleAt(r, 'blue', 16.5); // ice golem, hog, ice spirit, musketeer
    expect(c.exact).toBe(true);
    expect(c.next).toBe('ice-golem');
    expect(c.hand.sort()).toEqual(['cannon', 'fireball', 'skeletons', 'the-log']);
    expect(c.back).toEqual({ 'ice-golem': 1, 'hog-rider': 2, 'ice-spirit': 3, musketeer: 4 });
  });

  it('a champion played makes the hand inexact; the last three plays stay out', () => {
    const c = cycleAt(r, 'red', 40);
    expect(c.championOut).toBe(true);
    expect(c.exact).toBe(false);
    const out = Object.entries(c.spots).filter(([, s]) => s === 'queue').map(([k]) => k).sort();
    expect(out).toEqual(['baby-dragon', 'lightning', 'lumberjack']);
  });
});

describe('figures', () => {
  const r = parseReplay(page(PLAYS));

  it('elixir on cards is the running sum of what was played', () => {
    const s = elixirSeries(r);
    expect(elixirAt(s.blue, 30)).toBe(2 + 4 + 1 + 4 + 3 + 4);
    expect(elixirAt(s.blue, 0)).toBe(0);
  });

  it('a summary counts lanes, plays across the river and the most played card', () => {
    const blue = summarise(r, 'blue');
    expect(blue.plays).toBe(6);
    expect(blue.lanes).toEqual({ Left: 3, Centre: 2, Right: 1 });
    expect(blue.across).toBe(1); // the fireball
    const red = summarise(r, 'red');
    expect(red.abilities).toBe(1);
    // Every card once: the tie goes to the one played first.
    expect(red.most).toEqual({ key: 'golem', count: 1 });
  });

  it('depth is measured from the owner’s own back edge', () => {
    expect(zoneOf({ side: 'blue', x: 3.5, y: 14.5 })).toEqual({ lane: 'Left', depth: 'Bridge' });
    expect(zoneOf({ side: 'red', x: 14.5, y: 17.5 })).toEqual({ lane: 'Right', depth: 'Bridge' });
    expect(zoneOf({ side: 'red', x: 9, y: 31 })).toEqual({ lane: 'Centre', depth: 'Back' });
    expect(zoneLabel({ side: 'blue', x: 14.5, y: 25.5 })).toBe('Right · their side');
    expect(zoneOf({ side: 'blue', x: null, y: null })).toBeNull();
  });

  it('clock', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(65.9)).toBe('1:05');
    expect(clock(180)).toBe('3:00');
  });
});

describe('the library of opened replays', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    });
  });

  it('keeps newest first, once each, and forgets on request', async () => {
    const { keepReplay, listReplays, forgetReplay } = await import('../src/state/replayLibrary');
    const a = parseReplay(page(PLAYS));
    const b = parseReplay(page(PLAYS.slice(0, 3)));
    keepReplay(a, 1);
    keepReplay(b, 2);
    keepReplay(a, 3);
    expect(listReplays().map((e) => e.id)).toEqual([a.id, b.id]);
    forgetReplay(a.id);
    expect(listReplays().map((e) => e.id)).toEqual([b.id]);
  });

  it('survives storage that refuses to work', async () => {
    const { keepReplay, listReplays } = await import('../src/state/replayLibrary');
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('full');
      },
    } as unknown as Storage);
    expect(listReplays()).toEqual([]);
    expect(() => keepReplay(parseReplay(page(PLAYS)))).not.toThrow();
  });
});

describe('fitting a replay to a Recent Battles row', () => {
  const r = parseReplay(page(PLAYS)); // battle time 1762992000 on the page

  it('reads Supercell battle stamps', () => {
    expect(stampToUnix('20251113T000000.000Z')).toBe(1762992000);
    expect(stampToUnix('nonsense')).toBeNull();
  });

  it('turns a replay to the row player’s seat: players swapped, arena half-turned', () => {
    const turned = seenBy(r, '#9CVL2URG');
    expect(turned.players.blue.name).toBe('Sora Kite');
    expect(turned.players.red.name).toBe('Ember & Vale');
    expect(turned.events[0]).toMatchObject({ side: 'red', key: 'ice-golem', x: 18 - 3.5, y: 32 - 13.5 });
    // The searched player's troops land on the bottom half once turned.
    const golem = turned.events.find((e) => e.key === 'golem')!;
    expect(golem.side).toBe('blue');
    expect(golem.y!).toBeLessThan(16);
    // Already their seat, or a stranger: unchanged.
    expect(seenBy(r, 'PQ8RJ2Y0')).toBe(r);
    expect(seenBy(r, '#2PP')).toBe(r);
  });

  it('matches on both players, and on the moment when the page has one', async () => {
    const { replayFits } = await import('../src/state/replayLibrary');
    expect(replayFits(r, { tags: ['#9CVL2URG', '#PQ8RJ2Y0'], unix: 1762992000 + 30 })).toBe('same');
    expect(replayFits(r, { tags: ['#PQ8RJ2Y0', '#9CVL2URG'], unix: 1762992000 + 600 })).toBe('other-time');
    expect(replayFits(r, { tags: ['#PQ8RJ2Y0', '#2PP'], unix: 1762992000 })).toBe('other-players');
    expect(replayFits(r, { tags: ['#PQ8RJ2Y0', '#9CVL2URG'], unix: null })).toBe('same');
  });

  it('finds the replay kept for a row: by the row first, then by players and time', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    } as unknown as Storage);
    const { keepReplay, findReplayFor } = await import('../src/state/replayLibrary');
    const tags: [string, string] = ['#PQ8RJ2Y0', '#9CVL2URG'];
    expect(findReplayFor({ id: 'row-1', tags, unix: 1762992000 })).toBeNull();
    keepReplay(r, 1);
    // Not tied to a row yet: found because the time agrees…
    expect(findReplayFor({ id: 'row-1', tags, unix: 1762992000 + 20 })?.id).toBe(r.id);
    // …and not for another battle between the same two players.
    expect(findReplayFor({ id: 'row-2', tags, unix: 1762992000 + 3600 })).toBeNull();
    // Tied to a row, it is found for that row whatever the time says.
    keepReplay(r, 2, 'row-2');
    expect(findReplayFor({ id: 'row-2', tags, unix: 1762992000 + 3600 })?.id).toBe(r.id);
  });
});

describe('the Watch button', () => {
  const src = readFileSync('src/components/Analytics/RecentBattles.tsx', 'utf8').replace(/\r\n/g, '\n');

  it('admins only for now: no button, no read, no dialog for anyone else', () => {
    expect(src).toContain("const canImport = useAccess() === 'admin';");
    expect(src).toContain("const canWatch = canImport || REPLAYS_FOR === 'everyone';");
    expect(src).toContain('if (!canWatch) return;');
    expect(src).toContain('onWatch={canWatch && (has || (canImport && k != null)) ? () => setWatching(b) : undefined}');
    expect(src).toContain('{canWatch && watching && (');
    expect(src).toContain('canImport={canImport}');
  });

  it('opens over the list, not as a page of its own', () => {
    expect(src).toMatch(/lazy\(\(\) => import\('\.\/Replay\/WatchMatch'\)\)/);
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).not.toMatch(/replay/i);
  });

  it('the reader never touches the network', () => {
    for (const f of [
      'src/utils/replayParse.ts',
      'src/utils/htmlScan.ts',
      'src/utils/replayModel.ts',
      'src/state/replayLibrary.ts',
      'src/components/Analytics/Replay/WatchMatch.tsx',
    ]) {
      // Only state/replayStore.ts talks to a server, and only to our own /api/replays.
      const code = readFileSync(f, 'utf8');
      expect(code, f).not.toMatch(/\bfetch\(|XMLHttpRequest/);
      // A type from the API client is fine; a call into it is not.
      expect(code, f).not.toMatch(/import \{[^}]*\} from '[^']*analyticsClient'/);
    }
  });
});
