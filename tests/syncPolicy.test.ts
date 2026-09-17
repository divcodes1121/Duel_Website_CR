import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  SYNC_MAX_BYTES,
  decideSync,
  fitsSyncLimit,
  payloadBytes,
} from '../src/state/syncPolicy';

/**
 * THE BUG THIS FILE EXISTS FOR (2026-09-17):
 *
 *   111 saved duels -> save one -> UI shows 112 -> refresh -> 111.
 *
 * A saved duel set is ~2.2 kB of JSON, so a library of ~110 filled the old
 * 250 kB payload cap in `api/decks.ts`. Every PUT then answered 413, the client
 * ignored the response, and the remote copy froze. Because every page load
 * replaced local state with the remote blob, the next refresh overwrote the
 * newly saved set — which the persist middleware then wrote back over the good
 * local copy.
 *
 * The harness below is the real loop, modelled end to end: save writes local,
 * the push is size-capped and may fail, and a refresh runs the load path. Both
 * policies are exercised, so these tests FAIL against the old behaviour rather
 * than merely passing against the new one.
 */

interface SavedSet {
  id: string;
  name: string;
  mode: 'versus';
  savedAt: string;
  blue: unknown;
  red: unknown;
}

interface Payload {
  sets: Record<string, unknown>;
  library: SavedSet[];
  deckSlotCount: Record<string, number>;
  paletteFolders: unknown[];
}

const CARDS = [
  'hog-rider', 'musketeer', 'cannon', 'ice-spirit', 'skeletons', 'fireball',
  'the-log', 'ice-golem', 'goblin-barrel', 'princess', 'knight', 'valkyrie',
  'electro-wizard', 'minion-horde', 'giant', 'mini-pekka',
];

/**
 * UUID-SHAPED, AND THE LENGTH IS LOAD-BEARING. The store ids every deck and
 * every collection with `crypto.randomUUID()` — 36 characters. A saved versus
 * set carries 13 of them, so a short fake id understates a real set by ~325
 * bytes and a 111-set library by ~36 kB. The first version of this file used
 * `id-0000001` and measured 214 kB where production measures 252 kB, which put
 * the whole library UNDER the old cap and made the bug untestable.
 */
let seq = 0;
const id = () => {
  const hex = (seq += 1).toString(16).padStart(12, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4f00-8f00-${hex.padStart(12, '0')}`;
};

const deck = (i: number) => ({
  id: id(),
  name: `Deck ${i}`,
  slots: [...CARDS.slice(i % 8, (i % 8) + 8), ...CARDS].slice(0, 8),
  crowns: 1,
});

const collection = () => ({
  id: id(),
  name: 'Duel Deck',
  createdAt: '2026-09-17T00:00:00.000Z',
  updatedAt: '2026-09-17T00:00:00.000Z',
  decks: [1, 2, 3, 4, 5].map(deck),
});

/** A saved duel set the size of a real one. */
const savedSet = (n: number): SavedSet => ({
  id: id(),
  name: `Duel Deck ${n}`,
  mode: 'versus',
  savedAt: '2026-09-17T00:00:00.000Z',
  blue: collection(),
  red: collection(),
});

const emptyPayload = (): Payload => ({
  sets: { solo: collection(), blue: collection(), red: collection(), home: collection(), palette: collection() },
  library: [],
  deckSlotCount: { solo: 3, blue: 3, red: 3 },
  paletteFolders: [],
});

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * The save/sync/refresh loop, with the two policies side by side.
 *
 * `old` is the shipped behaviour that lost data: a push whose result is ignored,
 * and a load that always adopts the remote blob.
 */
class World {
  local: Payload = emptyPayload();
  /** ONE BLOB PER ACCOUNT, because the storage key is the user id. Modelling a
   *  single shared remote made a cross-account test adopt the other account's
   *  decks and call it isolation. */
  remotes: Record<string, Payload | undefined> = {};
  pending = false;
  pushes = 0;
  rejected = 0;
  signedInAs: string;

  constructor(
    readonly cap: number,
    readonly policy: 'old' | 'new',
    readonly owner = 'user-a',
  ) {
    this.signedInAs = owner;
  }

  get remote(): Payload | null {
    return this.remotes[this.signedInAs] ?? null;
  }

  /** Seed a collection that is already in sync, as the user's was. */
  seed(count: number) {
    for (let i = 1; i <= count; i += 1) this.local.library.unshift(savedSet(i));
    this.remotes[this.owner] = clone(this.local);
    this.pending = false;
    return this;
  }

  /** Save Duel: local state (and localStorage) gain the entry immediately. */
  save(n: number) {
    this.local.library.unshift(savedSet(n));
    this.pending = true;
    return this.push();
  }

  /** The debounced PUT. The server rejects anything over the cap. */
  push(): boolean {
    this.pushes += 1;
    if (payloadBytes(this.local) > this.cap) {
      this.rejected += 1;
      if (this.policy === 'new') this.pending = true;
      return false;                       // 413 — and the old client ignored it
    }
    this.remotes[this.signedInAs] = clone(this.local);
    this.pending = false;
    return true;
  }

  /** Page load: pull the remote blob and decide what to do with it. */
  refresh(signingInAs = this.signedInAs) {
    const sameOwner = signingInAs === this.signedInAs;
    this.signedInAs = signingInAs;
    if (!sameOwner) {
      this.local = emptyPayload();        // the cross-account reset
      this.pending = false;
    }
    if (this.policy === 'old') {
      if (this.remote) this.local = clone(this.remote);
      return;
    }
    const action = decideSync({
      sameOwner,
      hasRemote: Boolean(this.remote),
      pendingLocalChanges: this.pending,
    });
    if (action === 'adopt-remote' && this.remote) this.local = clone(this.remote);
    else if (action === 'keep-local-and-push') this.push();
    else if (action === 'seed-remote') this.push();
  }

  get count() {
    return this.local.library.length;
  }

  has(name: string) {
    return this.local.library.some((e) => e.name === name);
  }
}

const OLD_CAP = 250_000;

describe('the reported bug: 111 -> 112 -> refresh -> 111', () => {
  it('reproduces exactly against the old cap and the old load policy', () => {
    const w = new World(OLD_CAP, 'old').seed(111);
    expect(w.count).toBe(111);
    const landed = w.save(112);
    expect(landed).toBe(false);          // the PUT was rejected, silently
    expect(w.count).toBe(112);           // the UI is right: 112 on screen
    w.refresh();
    expect(w.count).toBe(111);           // ...and the refresh eats it
    expect(w.has('Duel Deck 112')).toBe(false);
  });

  it('is fixed by the new cap and the new load policy', () => {
    const w = new World(SYNC_MAX_BYTES, 'new').seed(111);
    expect(w.save(112)).toBe(true);
    w.refresh();
    expect(w.count).toBe(112);
    expect(w.has('Duel Deck 112')).toBe(true);
  });

  it('keeps the new duel even when the push fails outright', () => {
    // The cap is not the only way a push can fail: offline, 500, dead tunnel.
    // None of them may cost the user a duel they can see.
    const w = new World(0, 'new').seed(111);   // every push is rejected
    expect(w.save(112)).toBe(false);
    expect(w.count).toBe(112);
    w.refresh();
    expect(w.count).toBe(112);
    expect(w.has('Duel Deck 112')).toBe(true);
    expect(w.rejected).toBeGreaterThan(0);
  });
});

describe('the acceptance sequence', () => {
  it('111 -> save -> refresh -> 112 -> save -> refresh -> 113 -> refresh -> 113', () => {
    const w = new World(SYNC_MAX_BYTES, 'new').seed(111);
    w.save(112);
    w.refresh();
    expect(w.count).toBe(112);
    w.save(113);
    w.refresh();
    expect(w.count).toBe(113);
    w.refresh();
    expect(w.count).toBe(113);
    expect(w.has('Duel Deck 112')).toBe(true);
    expect(w.has('Duel Deck 113')).toBe(true);
  });

  it('survives repeated refreshes', () => {
    const w = new World(SYNC_MAX_BYTES, 'new').seed(111);
    w.save(112);
    for (let i = 0; i < 6; i += 1) {
      w.refresh();
      expect(w.count).toBe(112);
    }
  });

  it('is cumulative from an empty collection to well past the old ceiling', () => {
    const w = new World(SYNC_MAX_BYTES, 'new');
    for (const n of [1, 2, 10, 50, 100, 111, 112, 113]) {
      while (w.count < n) w.save(w.count + 1);
      w.refresh();
      expect(w.count).toBe(n);
    }
    // The old cap would have stopped syncing around here; the new one must not.
    expect(fitsSyncLimit(w.local)).toBe(true);
  });

  it('never loses a previously saved duel', () => {
    const w = new World(SYNC_MAX_BYTES, 'new').seed(111);
    const before = w.local.library.map((e) => e.name);
    w.save(112);
    w.refresh();
    for (const name of before) expect(w.has(name)).toBe(true);
    expect(w.count).toBe(112);
  });
});

describe('the payload cap', () => {
  it('the old 250 kB cap could not hold a real 111-set library', () => {
    const w = new World(OLD_CAP, 'old').seed(111);
    expect(payloadBytes(w.local)).toBeGreaterThan(OLD_CAP);
  });

  it('the new cap holds several hundred saved sets', () => {
    const w = new World(SYNC_MAX_BYTES, 'new').seed(300);
    expect(fitsSyncLimit(w.local)).toBe(true);
  });

  it('agrees with the number the server enforces', () => {
    // Two projects, one number: api/ cannot import from src/ (Node ESM does not
    // resolve extensionless relative imports there), so the agreement is pinned
    // here instead — the arrangement test_tracking.py already uses for the bot.
    const server = readFileSync(new URL('../api/decks.ts', import.meta.url), 'utf8');
    const match = server.match(/const MAX_BODY_BYTES = ([\d_]+);/);
    expect(match).not.toBeNull();
    expect(Number(match![1].replace(/_/g, ''))).toBe(SYNC_MAX_BYTES);
  });

  it('treats an unserialisable payload as too large rather than claiming it fits', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(fitsSyncLimit(circular)).toBe(false);
  });
});

describe('decideSync', () => {
  it('adopts the remote on a normal load with nothing pending', () => {
    expect(decideSync({ sameOwner: true, hasRemote: true, pendingLocalChanges: false }))
      .toBe('adopt-remote');
  });

  it('keeps local when the remote has not accepted the latest change', () => {
    expect(decideSync({ sameOwner: true, hasRemote: true, pendingLocalChanges: true }))
      .toBe('keep-local-and-push');
  });

  it('seeds an account that has never synced', () => {
    expect(decideSync({ sameOwner: true, hasRemote: false, pendingLocalChanges: false }))
      .toBe('seed-remote');
  });

  it('ALWAYS adopts for a different account, pending changes or not', () => {
    // User isolation outranks keeping unsynced work: local has already been
    // reset to empty, and the previous account's changes are not this
    // account's to push.
    expect(decideSync({ sameOwner: false, hasRemote: true, pendingLocalChanges: true }))
      .toBe('adopt-remote');
  });
});

describe('user isolation', () => {
  it("one account's unsynced duels never reach another account", () => {
    const w = new World(0, 'new').seed(111);   // pushes always fail
    w.save(112);
    expect(w.pending).toBe(true);
    const ownerBlobBefore = JSON.stringify(w.remotes['user-a']);

    w.refresh('user-b');                        // a different account signs in
    expect(w.count).toBe(0);                    // local was reset...
    // ...user A's cloud copy is untouched...
    expect(JSON.stringify(w.remotes['user-a'])).toBe(ownerBlobBefore);
    // ...and user B's is empty, not a copy of user A's 111 duels.
    expect(w.remotes['user-b']?.library.length ?? 0).toBe(0);
  });
});
