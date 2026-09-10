import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';

import { type AdminUser, type DuoDeck, type DuoPair, useAdminStore } from '../../state/adminStore';
import { getCardIconUrl } from '../../data/cards';
import { LiquidMetal } from '../../three/LiquidMetal';
import { useAccountStore } from '../../state/accountStore';
import { ago, bytes, until } from '../../utils/format';
import { useAccess } from '../../state/gate';
import { TIER_ADMIN_LABEL } from '../../state/tiers';
import { ThemeToggle } from '../Theme/ThemeToggle';
import styles from './AdminConsole.module.css';

/** Thousands separators, so 3278 reads as 3,278 at a glance. */
const nf = new Intl.NumberFormat();

/** Contabo Cloud VPS 6 root volume, from `df -h /` on the box. */
const VPS_DISK_BYTES = 387 * 1024 ** 3;

/**
 * A tile you can poke.
 *
 * IT IS A `div`, NOT A `button`, AND THAT IS THE POINT. These carry no action —
 * the brief was explicitly "clickable even where there is no click function,
 * just as a playing feature". A `<button>` would put every one of them in the
 * tab order and announce an actionable control to a screen reader that does
 * nothing when activated, which is a worse lie than a tile that simply looks
 * nice under the cursor. Pointer handlers give the toy to people using a
 * pointer and promise nothing to anyone else.
 *
 * THE HIGHLIGHT IS TWO CUSTOM PROPERTIES, NOT A RE-RENDER. `--mx`/`--my` are
 * written straight onto the node's style, so tracking the pointer never touches
 * React — sixty state updates a second across fifteen tiles is exactly the kind
 * of thing that made this project's earlier effects lag.
 *
 * The ripple is a class toggled off on `animationend`, so it is ONE-SHOT and
 * re-arms on the next press. `CLAUDE.md` bans `infinite` outright; the old glow
 * loops animating box-shadow are what that ban is for.
 */
function usePoke<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  const track = (e: ReactPointerEvent<T>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
  };

  const press = (e: ReactPointerEvent<T>) => {
    const el = ref.current;
    if (!el) return;
    track(e);
    // Restart even mid-flight: remove, force a reflow, re-add.
    el.classList.remove(styles.rippling);
    void el.offsetWidth;
    el.classList.add(styles.rippling);
  };

  return {
    ref,
    onPointerMove: track,
    onPointerDown: press,
    onAnimationEnd: () => ref.current?.classList.remove(styles.rippling),
  };
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'good' | 'warn' | 'bad';
}) {
  const poke = usePoke<HTMLDivElement>();

  return (
    <div className={styles.stat} data-tone={tone} {...poke}>
      <span className={styles.statLabel}>{label}</span>
      <strong className={styles.statValue}>{value}</strong>
      {note && <span className={styles.statNote}>{note}</span>}
    </div>
  );
}

/** A capacity bar. Colour is a FUNCTION of the fill, so it cannot disagree. */
function Meter({ used, total, label }: { used: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const tone = pct > 90 ? 'bad' : pct > 75 ? 'warn' : 'good';
  const poke = usePoke<HTMLDivElement>();
  return (
    <div className={styles.meter} {...poke}>
      <div className={styles.meterHead}>
        <span>{label}</span>
        <span className={styles.meterFigure}>
          {bytes(used)} / {bytes(total)} · {pct.toFixed(1)}%
        </span>
      </div>
      <div className={styles.meterTrack}>
        <div className={styles.meterFill} data-tone={tone} style={{ scale: `${pct / 100} 1` }} />
      </div>
    </div>
  );
}

/** Hours since an ISO stamp, or null when there is nothing to measure. */
function hoursSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 3_600_000;
}

/**
 * A two-segment bar: the part of the file holding data, and the part that is
 * free space SQLite will write into before it grows the file again.
 *
 * THIS IS THE WHOLE REASON THE OPS BLOCK EXISTS. A single "33.3 GB" figure
 * cannot distinguish a collector that has died from one that is healthily
 * re-using pages a large delete freed earlier — in both cases the number sits
 * still. Splitting the bar makes the second case legible: a wide free segment
 * IS the explanation for a size that has not moved.
 *
 * The free segment is drawn in the warn hue rather than a neutral, because it
 * is not spare capacity in the way the disk meter's remainder is — it is space
 * already charged to this file that the file has not given back.
 */
function Split({
  live,
  free,
  label,
  note,
  /* THE DEFAULTS ARE THE STORAGE METER THIS WAS WRITTEN FOR, so its two
     existing callers are unchanged. They are props because the same two-part
     bar now also draws a COUNT — the 2v2 rows that can and cannot be
     reconstructed — and `bytes(1080047)` would print "1.08 MB" of rows, which
     is a wrong number rather than a wrong label. */
  format = bytes,
  liveLabel = 'data',
  freeLabel = 'free',
  pctLabel = 'reclaimable',
}: {
  live: number;
  free: number;
  label: string;
  note?: string;
  format?: (n: number) => string;
  liveLabel?: string;
  freeLabel?: string;
  pctLabel?: string;
}) {
  const total = live + free;
  const pct = total > 0 ? (free / total) * 100 : 0;
  const poke = usePoke<HTMLDivElement>();
  return (
    <div className={styles.meter} {...poke}>
      <div className={styles.meterHead}>
        <span>{label}</span>
        <span className={styles.meterFigure}>
          {format(live)} {liveLabel} · {format(free)} {freeLabel} ·{' '}
          {pct.toFixed(1)}% {pctLabel}
        </span>
      </div>
      {/* FLEX, not the scale transform `.meterFill` uses. That one grows from
          a left origin and is right for ONE bar; two of them would sit on top
          of each other. Proportion here is flex-grow, so the segments share the
          track and always add up to it exactly. */}
      <div className={styles.splitTrack}>
        <div className={styles.splitLive} style={{ flexGrow: live }} />
        <div className={styles.splitFree} style={{ flexGrow: free }} />
      </div>
      {note && <p className={styles.meterNote}>{note}</p>}
    </div>
  );
}

/** The eight cards of one deck in a partnership. */
function DuoDeckStrip({ deck, label }: { deck: DuoDeck; label: string }) {
  return (
    <div className={styles.duoDeck}>
      <span className={styles.duoDeckLabel}>
        {label}
        <span className={styles.duoElixir}>{deck.avgElixir}</span>
      </span>
      <div className={styles.duoCards}>
        {/* CANONICAL (sorted) order, which is the order the fingerprint is
            computed from. A play order would be invented — `arrange_deck`
            needs per-battle art marks a deduplicated deck does not have — and
            this row's whole job is to state an identity exactly. */}
        {deck.cards.map((c) => (
          <img
            key={c.key}
            className={styles.duoCard}
            src={getCardIconUrl(c.key)}
            alt={c.name}
            title={`${c.name} · id ${c.id} · ${c.elixir} elixir`}
            loading="lazy"
            width={34}
            height={41}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One unique 2v2 partnership.
 *
 * TWO DECKS, NOT ONE. The unit of this board is a combination of two teammate
 * decks — that is what a 2v2 player actually chooses, and a board of single
 * decks cannot express it. The identity is order-free at both levels, so the
 * two strips below are shown in canonical order rather than in the order
 * anyone happened to play them.
 */
function DuoPairRow({ pair }: { pair: DuoPair }) {
  return (
    <div className={styles.duoPair}>
      <div className={styles.duoPairDecks}>
        <DuoDeckStrip deck={pair.deckA} label="Deck A" />
        <span className={styles.duoVs} aria-hidden="true">+</span>
        <DuoDeckStrip deck={pair.deckB} label="Deck B" />
      </div>
      <dl className={styles.duoFacts}>
        <div>
          <dt>Played</dt>
          <dd className={styles.duoFigure}>{pair.occurrences.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Players</dt>
          <dd className={styles.duoFigure}>{pair.players.toLocaleString()}</dd>
        </div>
        <div>
          <dt>First seen</dt>
          <dd>{ago(pair.firstSeen)}</dd>
        </div>
        <div>
          <dt>Last seen</dt>
          <dd>{ago(pair.lastSeen)}</dd>
        </div>
        <div>
          <dt>Pair</dt>
          {/* Everything needed to reconcile this row against the database by
              hand, without spending the width on any of it. */}
          <dd
            className={styles.mono}
            title={`${pair.pairFingerprint}
A ${pair.deckA.fingerprint}
B ${pair.deckB.fingerprint}
from: ${pair.sourceModes.join(', ') || '—'}
tags: ${pair.playerTags.join(', ') || '—'}`}
          >
            {pair.pairFingerprint.replace(/^2v2:/, '').slice(0, 10)}
            {/* Both teammates on the same list. A real pairing, and worth
                marking because it otherwise reads as a rendering bug. */}
            {pair.mirror && <span className={styles.you}>mirror</span>}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * Items 4, 5 and 6: every account, their tier, and what the deployment can reach.
 *
 * ONE SCREEN, because they are one question — "what is going on" — and splitting
 * it into three would mean checking three places to answer it.
 *
 * WHAT IT DOES NOT CLAIM. "Users currently online" is not a number this can
 * honestly report: there is no socket, and a JWT is valid for an hour whether
 * or not its owner is looking at the page. What IS knowable is when each
 * account last signed in and how many device slots it holds, so that is what is
 * shown — and it is labelled as such rather than dressed up as presence.
 */
export function AdminConsole() {
  const access = useAccess();
  /* YOUR OWN ROW IS READ-ONLY. `admin_set_role` refuses `target = auth.uid()`
     outright, so this only stops you discovering that by being told no — the
     database is the rule, this is the courtesy. */
  const meId = useAccountStore((s) => s.userId);
  const { users, health, analytics, analyticsMs, collection, loading, error, load, setRole, endTrial,
          duo, duoLoading, duoError, loadDuo } = useAdminStore();
  const [query, setQuery] = useState('');
  const [duoOpen, setDuoOpen] = useState(false);
  const [duoQuery, setDuoQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  /* Closed by default. Opening the console is usually a health check, not a
     hunt for one person. */
  const [accountsOpen, setAccountsOpen] = useState(false);

  /* The ops block rides on the same coverage response as the tracked
     count. OPTIONAL: an analytics API that has not been redeployed yet
     does not send it, and every section below is guarded rather than
     assuming it is there — the two halves ship separately, so there is
     always a window where the site is ahead of the service. */
  const ops = collection?.ops;

  useEffect(() => {
    if (access === 'admin') void load();
  }, [access, load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.email, u.display_name, u.player_tag, u.country, u.role]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q)),
    );
  }, [users, query]);

  const counts = useMemo(() => {
    const c = { free: 0, trial: 0, pro: 0, admin: 0, devices: 0, recent: 0 };
    const dayAgo = Date.now() - 86_400_000;
    for (const u of users) {
      c[u.tier] += 1;
      c.devices += u.devices;
      if (u.last_sign_in_at && Date.parse(u.last_sign_in_at) > dayAgo) c.recent += 1;
    }
    return c;
  }, [users]);

  if (access !== 'admin') {
    return (
      <section className={styles.denied}>
        <h2>Not your console</h2>
        <p>
          This screen is for administrators. Hiding it is a courtesy — the data
          behind it is refused by the database itself, so there is nothing here
          to find.
        </p>
      </section>
    );
  }

  async function change(u: AdminUser, value: string) {
    setBusyId(u.id);
    const err =
      value === '__end_trial'
        ? await endTrial(u.id)
        : await setRole(u.id, value as AdminUser['role']);
    setBusyId(null);
    if (err) alert(err);
  }

  return (
    <section className={styles.wrap}>
      {/* ONE canvas for every `[data-metal]` control on this route. Idle until
          something is hovered, pressed or carrying a live ripple, and it tears
          the rAF down when the last of those settles. */}
      <LiquidMetal />
      <header className={styles.head}>
        {/* A WAY BACK. The console is its own route outside the Dashboard, so
            it inherits none of the app's navigation — without this the only
            exit is the browser's back button, and there is none at all for
            someone who arrived by typing the URL. */}
        <a className={styles.back} href="#/">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
               strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Home
        </a>

        <h2 className={styles.title}>Console</h2>

        <div className={styles.headActions}>
          {/* Every colour here is already a token, so the console follows the
              theme — but the control to CHANGE it lives in the Dashboard header
              this route does not render. */}
          <ThemeToggle size="1.8rem" />
          {/* The same travelling chromatic rim the app's other round controls
              wear. It needs the canvas below — the console renders outside the
              Dashboard, so it does not inherit the one mounted there. */}
          <button type="button" className={styles.refresh} data-metal
                  onClick={() => void load()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      {/* --- accounts ------------------------------------------------------ */}
      <div className={styles.stats}>
        <Stat label="Accounts" value={String(users.length)} />
        {/* The two are no longer the same product, so the tiles say so. A
            trial is everything for three days EXCEPT Coach Assist; paid Pro is
            the only tier that opens it. */}
        <Stat label="Members" value={String(counts.trial)} note="no Coach Assist" tone="good" />
        <Stat label="Pro" value={String(counts.pro)} note="paid · full access" tone="good" />
        <Stat label="Free" value={String(counts.free)} />
        <Stat
          label="Signed in today"
          value={String(counts.recent)}
          note="last sign-in, not presence"
        />
        <Stat label="Device slots held" value={String(counts.devices)} note="max 2 per account" />
        {/* THE COLLECTION, not the accounts. Everything else on this row counts
            people who signed up; this counts the players the bot is polling,
            which is what the whole analytics half is built on and is a far
            bigger number. Searching an untracked tag enrols it here, so it is
            also the figure that moves when the site is used. */}
        {collection && (
          <Stat
            label="Tracked players"
            value={nf.format(collection.trackedPlayers)}
            note={
              collection.global?.days
                ? `${collection.global.days} days of battles stored`
                : 'collected by the bot'
            }
          />
        )}
      </div>

      {/* --- is the collection alive -------------------------------------- */}
      {/* FIRST, ABOVE EVERYTHING ELSE, because it is the question the console
          could not answer. "Storage is stuck at 33.3 GB" was the symptom that
          started this, and the honest reading — a healthy bot writing into
          reclaimed pages — needed four separate figures none of which were on
          the screen. The newest battle is the one that settles it: if that is
          minutes old, data is arriving, whatever the file size is doing. */}
      {ops?.collection && (
        <>
          <h3 className={styles.section}>Collection</h3>
          <div className={styles.stats}>
            {(() => {
              /* THE HEADLINE SIGNAL. The bot polls every two hours, so a gap
                 under ~3h is an ordinary trough between passes and says
                 nothing. Past 6h a pass has been missed outright, which is the
                 first thing that is actually wrong rather than merely quiet. */
              const h = hoursSince(ops.collection!.newestBattle);
              const tone = h === null ? undefined : h > 6 ? 'bad' : h > 3 ? 'warn' : 'good';
              return (
                <Stat
                  label="Newest battle"
                  value={ops.collection!.newestBattle ? ago(ops.collection!.newestBattle) : '—'}
                  note={h === null ? 'nothing stored' : 'the bot polls every 2h'}
                  tone={tone}
                />
              );
            })()}
            {ops.collection.lastPollAt && (
              <Stat
                label="Last poll"
                value={ago(ops.collection.lastPollAt)}
                note={
                  ops.collection.lastPollMs
                    ? `took ${(ops.collection.lastPollMs / 60000).toFixed(1)} min`
                    : 'completed'
                }
              />
            )}
            {ops.collection.pollFailurePct !== null && (
              /* A RATE BETWEEN THE LAST TWO POLLS, not a lifetime total. The
                 stored counters are cumulative, so the raw pair is a big number
                 that says nothing about now. The CR API genuinely returns 5xx
                 under load, so a small non-zero figure is the normal state and
                 only a jump is worth reading. */
              <Stat
                label="Poll failures"
                value={`${ops.collection.pollFailurePct.toFixed(2)}%`}
                note="of last poll's API calls"
                tone={
                  ops.collection.pollFailurePct > 10
                    ? 'bad'
                    : ops.collection.pollFailurePct > 3
                      ? 'warn'
                      : 'good'
                }
              />
            )}
            <Stat
              label="Battles stored"
              value={nf.format(ops.collection.battles)}
              note={
                collection?.global?.days
                  ? `over ${collection.global.days} days`
                  : 'in the hot tier'
              }
            />
            <Stat
              label="Tracked players"
              value={nf.format(ops.collection.trackedPlayers)}
              note="polled by the bot"
            />
            {ops.collection.oldestBattle && (
              <Stat
                label="History reaches"
                value={ops.collection.oldestBattle.slice(0, 10)}
                note="oldest battle held"
              />
            )}
          </div>
        </>
      )}

      {/* --- storage -------------------------------------------------------- */}
      {(ops?.storage || analytics?.hot.available) && (
        <>
          <h3 className={styles.section}>Storage</h3>
          {ops?.storage && (
            <Split
              live={ops.storage.liveBytes}
              free={ops.storage.freeBytes}
              label="Inside battles.db"
              note={
                ops.storage.freeBytes > 0
                  ? 'SQLite never shrinks a file. Pages freed by a delete go on a freelist and are written into before the file grows again — so a size that has not moved is not the same as a collection that has stopped.'
                  : 'No free pages: every new battle extends the file.'
              }
            />
          )}
          {analytics?.hot.available && (
            <Meter
              used={analytics.hot.sizeBytes}
              total={VPS_DISK_BYTES}
              label="battles.db on the Contabo volume"
            />
          )}
          <div className={styles.stats}>
            {ops?.storage && (
              <>
                <Stat
                  label="File on disk"
                  value={bytes(ops.storage.fileBytes)}
                  note={`${nf.format(ops.storage.pageCount)} pages of ${bytes(ops.storage.pageSize)}`}
                />
                <Stat
                  label="Reclaimable"
                  value={bytes(ops.storage.freeBytes)}
                  note={`${nf.format(ops.storage.freePages)} free pages`}
                  tone={ops.storage.freeBytes > ops.storage.liveBytes / 3 ? 'warn' : undefined}
                />
              </>
            )}
            {/* THE RUNWAY, and it is BLANK unless the service has been told the
                window. The bot owns `CLASH_RETENTION_DAYS`; this service is not
                given it, so printing 304 here would be repeating a number from
                memory on the one screen whose whole value is being trusted. */}
            {ops?.retention && (
              <Stat
                label="Retention"
                value={ops.retention.days ? `${ops.retention.days} days` : 'unknown'}
                note={
                  ops.retention.days
                    ? ops.retention.daysUntilFirstDelete !== null
                      ? `first deletion in ${nf.format(ops.retention.daysUntilFirstDelete)} days`
                      : `boundary ${ops.retention.boundary}`
                    : 'set CLASH_RETENTION_DAYS to show the runway'
                }
                tone={
                  ops.retention.daysUntilFirstDelete !== null &&
                  ops.retention.daysUntilFirstDelete < 14
                    ? 'warn'
                    : undefined
                }
              />
            )}
          </div>
        </>
      )}

      {/* --- the rollup ----------------------------------------------------- */}
      {/* WHAT THIS CATCHES, and it caught it on the live database the day it
          was written: the watermark advances to NOW after every poll and folds
          only the window it just passed, so any row ARRIVING with an older
          timestamp — every backfill, every battle retried after a sync error —
          is never folded. Nothing on this screen showed it, and the repair
          (a full rebuild) has no live caller at all. */}
      {ops?.aggregates && (
        <>
          <h3 className={styles.section}>Rollup</h3>
          <div className={styles.stats}>
            {ops.aggregates.coveragePct !== null && (
              <Stat
                label="Aggregate coverage"
                value={`${ops.aggregates.coveragePct.toFixed(1)}%`}
                note="of stored battles are folded in"
                tone={
                  ops.aggregates.coveragePct > 95
                    ? 'good'
                    : ops.aggregates.coveragePct > 80
                      ? 'warn'
                      : 'bad'
                }
              />
            )}
            <Stat
              label="Folded battles"
              value={nf.format(ops.aggregates.statsBattles)}
              note="player_stats_agg"
            />
            <Stat
              label="Matchup games"
              value={nf.format(ops.aggregates.pairGames)}
              /* NOT a ratio against stored battles: this table dedups a battle
                 seen from both sides when both players are tracked, so the two
                 are not the same denominator and a percentage would invent a
                 gap that is partly legitimate. */
              note="pair_matchup_agg · mirror-deduped"
            />
            {ops.aggregates.watermark && (
              <Stat
                label="Watermark"
                value={ago(ops.aggregates.watermark)}
                note="advances after every poll"
              />
            )}
            {(() => {
              /* THE REPAIR MECHANISM'S OWN CLOCK. Incremental folds drift; a
                 full rebuild is what corrects them. If this is weeks old the
                 coverage figure above will keep falling, and knowing which of
                 the two to read is the point of showing both. */
              const h = hoursSince(ops.aggregates!.lastRebuild);
              const days = h === null ? null : Math.floor(h / 24);
              return (
                <Stat
                  label="Last full rebuild"
                  value={ops.aggregates!.lastRebuild ? ago(ops.aggregates!.lastRebuild) : 'never'}
                  note={days === null ? 'no record' : 'repairs rollup drift'}
                  tone={days === null ? 'warn' : days > 14 ? 'bad' : days > 7 ? 'warn' : 'good'}
                />
              );
            })()}
          </div>
        </>
      )}

      {/* --- the site, the API and the domain ------------------------------ */}
      <h3 className={styles.section}>Site &amp; domain</h3>
      <div className={styles.stats}>
        <Stat
          label="Deployment"
          value={health?.commit ?? '—'}
          note={health ? `${health.env} · ${health.region ?? '?'}` : 'unreachable'}
          tone={health ? 'good' : 'bad'}
        />
        <Stat
          label="Analytics API"
          value={analytics ? `${analyticsMs} ms` : 'down'}
          note={analytics?.hot.available ? 'api.deckkies.com · database attached' : 'no database'}
          tone={analytics?.hot.available ? 'good' : 'bad'}
        />
        {/* A DATABASE THAT OPENS IS NOT A SERVICE THAT CAN ANSWER. The card
            reference files went missing on the VPS deploy and every analytics
            screen kept returning 200 — Win Conditions and Spells showed 0, the
            Cards board was blank, and every deck name went generic — with
            nothing anywhere reporting a fault. This tile is the fault. */}
        {analytics?.cardData && (
          <Stat
            label="Card data"
            value={analytics.cardData.loaded ? `${analytics.cardData.count} cards` : 'MISSING'}
            note={
              analytics.cardData.loaded
                ? 'win cons, spells, elixir'
                : (analytics.cardData.error ?? 'not loaded')
            }
            tone={analytics.cardData.loaded ? 'good' : 'bad'}
          />
        )}
        {/* THE RECRUITER, which enrols players nobody searched for. It rides on
            /status and is otherwise invisible: "enabled but has never completed
            a run" looks exactly like "working" from every other angle. */}
        {analytics?.recruit && (
          <Stat
            label="Recruiter"
            value={analytics.recruit.enabled ? `${nf.format(analytics.recruit.runs)} runs` : 'off'}
            note={
              analytics.recruit.enabled
                ? analytics.recruit.lastRunAt
                  ? `last ${ago(analytics.recruit.lastRunAt)} · ${nf.format(analytics.recruit.queued)} queued`
                  : 'never completed a run'
                : 'CLASH_RECRUIT=off'
            }
            tone={
              !analytics.recruit.enabled
                ? undefined
                : analytics.recruit.lastRunAt
                  ? 'good'
                  : 'warn'
            }
          />
        )}
        {health &&
          (() => {
            /* ONE TILE, NOT SEVEN SAYING "set".
               These are `/api/health`'s configured booleans — whether this
               deployment can reach each integration. As a tile each they were
               six identical "set"s and one "not set", which buries the only one
               worth reading in six that are not. Same rule as the tone borders
               a few lines up: the point of a signal is the one that is NOT
               fine, and a wall of green is a dashboard shouting.
               So the tile answers "is anything missing" and NAMES what, which
               is the whole question these ever answered. */
            const entries = Object.entries(health.configured);
            const missing = entries.filter(([, v]) => !v).map(([k]) => k);
            const pretty = (k: string) => k.replace(/([A-Z])/g, ' $1').toLowerCase();
            return (
              <Stat
                label="Integrations"
                value={`${entries.length - missing.length} / ${entries.length}`}
                note={missing.length ? `missing: ${missing.map(pretty).join(', ')}` : 'all configured'}
                tone={missing.length ? 'warn' : 'good'}
              />
            );
          })()}
      </div>

      {/* --- the accounts themselves --------------------------------------- */}
      {/* THE ACCOUNTS LIST IS COLLAPSED UNTIL ASKED FOR.
          It is the longest thing on the page by far and the least often the
          reason for opening the console — the tiles above answer "is anything
          wrong" at a glance, and the table answers "who exactly", which is a
          second question. Closed, the whole console fits without scrolling.

          UNMOUNTED, not hidden with CSS: a closed table should not be building
          rows, and it must not leave its cells in the tab order for a keyboard
          user who cannot see them. */}
      <button
        type="button"
        className={styles.sectionToggle}
        aria-expanded={accountsOpen}
        onClick={() => setAccountsOpen((o) => !o)}
      >
        <svg className={styles.sectionChev} viewBox="0 0 24 24" width="13" height="13"
             fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"
             strokeLinejoin="round" aria-hidden="true" data-open={accountsOpen || undefined}>
          <path d="M9 6l6 6-6 6" />
        </svg>
        Accounts
        <span className={styles.sectionCount}>
          {users.length}
        </span>
      </button>

      {accountsOpen && (
        <>
      <div className={styles.searchRow}>
        <input
          className={styles.search}
          value={query}
          placeholder="Filter by email, name, tag or country…"
          onChange={(e) => setQuery(e.target.value)}
        />
        {/* The filter hides rows, so say how many. Without this a typo in the
            box and an account that genuinely does not exist look identical. */}
        <span className={styles.count}>
          {query.trim() && shown.length !== users.length
            ? `${shown.length} of ${users.length}`
            : `${users.length} account${users.length === 1 ? '' : 's'}`}
        </span>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Tier</th>
              <th>Country</th>
              <th>Player tag</th>
              <th>Last sign-in</th>
              <th>Devices</th>
              <th>Access</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id}>
                <td className={styles.name}>
                  {u.display_name ?? '—'}
                  {/* Says WHY the controls in this row are dead. A disabled
                      control with no explanation reads as a bug. */}
                  {u.id === meId && <span className={styles.you}>you</span>}
                  {/* THE OWNER IS MARKED, not just protected. An admin who can
                      see one row they cannot edit, and no reason why, will
                      assume the console is broken. */}
                  {u.is_owner && (
                    <span
                      className={styles.you}
                      data-owner=""
                      title="The owner. No admin can change this account's role or end its trial — the database refuses it, so promoting somebody can never cost you the console."
                    >
                      owner
                    </span>
                  )}
                </td>
                <td className={styles.email}>{u.email ?? '—'}</td>
                <td>
                  <span className={styles.tier} data-tier={u.tier}>
                    {TIER_ADMIN_LABEL[u.tier] ?? u.tier}
                  </span>
                  {u.tier === 'trial' && u.trial_ends_at && (
                    <span className={styles.sub}>ends {until(u.trial_ends_at)}</span>
                  )}
                </td>
                <td>{u.country ?? '—'}</td>
                <td className={styles.mono}>{u.player_tag ?? '—'}</td>
                <td>{ago(u.last_sign_in_at)}</td>
                <td>{u.devices}</td>
                <td>
                  <select
                    className={styles.roleSelect}
                    value={u.role}
                    disabled={busyId === u.id || u.id === meId || !!u.is_owner}
                    onChange={(e) => void change(u, e.target.value)}
                    title={
                      u.is_owner
                        ? "The owner's role cannot be changed by anyone, including another owner session. Moving it means editing supabase/002_owner.sql and re-running it in the dashboard"
                        : u.id === meId
                          ? 'You cannot change your own role — the database refuses it, so a misclick cannot lock you out of this console'
                          : 'Grant paid Pro, make an admin, or drop back to free'
                    }
                  >
                    <option value="free">free</option>
                    <option value="pro">pro — paid</option>
                    <option value="admin">admin</option>
                  </select>

                  {/* ENDING A TRIAL IS AN ACTION, SO IT IS A BUTTON.
                      It used to be a fourth <option> in the select above,
                      disabled unless the account was mid-trial — which made the
                      one control an admin reaches for most the one thing they
                      could not click. It is also not a role: a lapsed trial
                      user is still `free`, so putting it in a list of roles
                      meant choosing it had to leave them on something.

                      ALWAYS ENABLED. Ending a trial that has already ended is a
                      no-op (`trial_ends_at = now()` twice is the same answer),
                      and refusing the click to prevent a harmless no-op is what
                      made this feel blocked. */}
                  <button
                    type="button"
                    className={styles.endTrial}
                    disabled={busyId === u.id || u.id === meId || !!u.is_owner}
                    onClick={() => void change(u, '__end_trial')}
                    title={
                      u.is_owner
                        ? "The owner's account cannot be modified from here"
                        : u.tier === 'trial'
                          ? 'End this trial now — they drop to their role immediately'
                          : 'No trial running. This stamps the trial as spent so a later role change cannot hand them another one'
                    }
                  >
                    End trial
                  </button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={8} className={styles.empty}>
                  {loading ? 'Loading…' : users.length ? 'Nothing matches that.' : 'No accounts yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
        </>
      )}

      {/* --- 2v2 deck pairs ------------------------------------------------ */}
      {/* WHERE THE 2v2 DATA WENT, rather than where it was deleted from.
          Recent Battles refuses a `TeamVsTeam` row because that screen draws
          one deck against one deck and four people played it. The battle is
          not discarded: the two decks on each side are folded into a unique
          PARTNERSHIP with an occurrence count.

          NOTHING HAS BEEN DELETED. This is phase 1 — `battles` still holds
          every 2v2 row, and the summary says so. */}
      <button
        type="button"
        className={styles.sectionToggle}
        aria-expanded={duoOpen}
        onClick={() => {
          const next = !duoOpen;
          setDuoOpen(next);
          if (next && !duo && !duoLoading) void loadDuo(1, '');
        }}
      >
        <svg className={styles.sectionChev} viewBox="0 0 24 24" width="13" height="13"
             fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"
             strokeLinejoin="round" aria-hidden="true" data-open={duoOpen || undefined}>
          <path d="M9 6l6 6-6 6" />
        </svg>
        2v2 deck pairs
        {duo && (
          <span className={styles.sectionCount}>
            {duo.summary.uniquePairs.toLocaleString()}
          </span>
        )}
      </button>

      {duoOpen && (
        <>
          {duoError && <p className={styles.error}>{duoError}</p>}

          {duo && !duo.summary.built && !duoError && (
            <p className={styles.hint}>
              The pair collection has never been built. Run{' '}
              <code>python server/duo_pairs.py --migrate</code> on the analytics
              host to fold the surviving 2v2 payloads into unique partnerships.
              It deletes nothing.
            </p>
          )}

          {duo && duo.summary.built && (
            <>
              <div className={styles.stats}>
                <Stat label="Unique pairs" value={duo.summary.uniquePairs.toLocaleString()}
                      note="one record per combination of two teammate decks" />
                <Stat label="Battles folded" value={duo.summary.battlesFolded.toLocaleString()}
                      note="real battles, deduplicated across participants" />
                <Stat
                  label="Battles per pair"
                  value={
                    duo.summary.uniquePairs
                      ? (duo.summary.occurrences / duo.summary.uniquePairs).toFixed(1)
                      : '—'
                  }
                  note="how much the deduplication collapsed"
                />
                <Stat label="Built" value={duo.summary.builtAt ? ago(duo.summary.builtAt) : '—'}
                      note={`phase ${duo.summary.phase} · nothing deleted`} />
                {/* WHAT THIS BOARD IS A CENSUS OF, said plainly. 866,226 people
                    have played a 2v2 that reached us; per-battle detail is kept
                    for the top N only, and a page that showed a ranking without
                    saying so would read as the complete population. */}
                <Stat
                  label="Population"
                  value={`Top ${duo.summary.populationLimit.toLocaleString()}`}
                  note={
                    duo.summary.participants
                      ? `${duo.summary.population.toLocaleString()} of ${duo.summary.participants.toLocaleString()} participants · cut at ${duo.summary.populationCut.toLocaleString()} battles`
                      : 'bounded 2v2 player detail'
                  }
                />
              </div>

              {/* THE HONEST HALF, AND IT IS NOT A WARNING — it is the state of
                  the data. 21.8% of the 2v2 rows lost their raw payload to the
                  cap valve, so their teammate's deck is unrecoverable and no
                  pair exists for them. Saying so beside the figures is the
                  difference between a migration and a claim about one. */}
              {duo.summary.rows2v2 > 0 && (
                <Split
                  label="2v2 rows still in battles"
                  live={duo.summary.reconstructable}
                  free={duo.summary.unreconstructable}
                  format={(n) => n.toLocaleString()}
                  liveLabel="reconstructable"
                  freeLabel="payload gone"
                  pctLabel="unrecoverable"
                  note={`All ${duo.summary.rows2v2.toLocaleString()} rows remain in the battles table — phase 1 deletes nothing. The ${duo.summary.unreconstructable.toLocaleString()} whose raw payload was purged have no recoverable partner deck, so no pair exists for them and none was invented.`}
                />
              )}

              <div className={styles.searchRow}>
                <input
                  className={styles.search}
                  value={duoQuery}
                  placeholder="Filter by card key, e.g. hog-rider…"
                  onChange={(e) => setDuoQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void loadDuo(1, duoQuery); }}
                />
                {/* SERVER-PAGED, so the filter is a request. There are far more
                    pairs than are ever sent here, and filtering what arrived
                    would quietly search one page of a ranking. */}
                <button className={styles.refresh} type="button" data-metal
                        onClick={() => void loadDuo(1, duoQuery)}>
                  Search
                </button>
                <span className={styles.count}>
                  {duoLoading
                    ? 'Loading…'
                    : `${duo.total.toLocaleString()} pair${duo.total === 1 ? '' : 's'}`}
                </span>
              </div>

              <div className={styles.duoList}>
                {duo.pairs.map((p) => <DuoPairRow key={p.pairFingerprint} pair={p} />)}
                {!duo.pairs.length && (
                  <p className={styles.empty}>
                    {duoLoading ? 'Loading…' : 'Nothing matches that.'}
                  </p>
                )}
              </div>

              {duo.pages > 1 && (
                <div className={styles.duoPager}>
                  <button className={styles.refresh} type="button" data-metal
                          disabled={duo.page <= 1 || duoLoading}
                          onClick={() => void loadDuo(duo.page - 1, duoQuery)}>
                    Previous
                  </button>
                  <span className={styles.count}>
                    Page {duo.page.toLocaleString()} of {duo.pages.toLocaleString()}
                  </span>
                  <button className={styles.refresh} type="button" data-metal
                          disabled={duo.page >= duo.pages || duoLoading}
                          onClick={() => void loadDuo(duo.page + 1, duoQuery)}>
                    Next
                  </button>
                </div>
              )}

              <p className={styles.hint}>
                Showing every unique partnership; detailed per-player 2v2
                history is retained for the top{' '}
                {duo.summary.populationLimit.toLocaleString()} participants by
                distinct battles, recalculated rather than frozen. Folded from{' '}
                {duo.summary.sourceModes.join(' and ') || '2v2 battles'},
                read from the raw API payload rather than from{' '}
                <code>battles</code> — a battle row holds one deck and one
                opponent deck, and the teammate&rsquo;s deck is in no column of
                it. Each battle contributes two partnerships, theirs and yours,
                counted once however many participants stored it. Card order and
                deck order do not affect identity.
              </p>
            </>
          )}
        </>
      )}

    </section>
  );
}
