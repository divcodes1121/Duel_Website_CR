import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAccountStore } from '../../state/accountStore';
import { useBuilderStore } from '../../state/store';
import { ThemeToggle } from '../Theme/ThemeToggle';
import { TierBadge } from '../TierBadge/TierBadge';
import { useThemeStore } from '../../state/themeStore';
import { TIER_LABEL, trialDaysLeft } from '../../state/tiers';
import { ProContact } from '../Analytics/ProContact';
import { useAccess } from '../../state/gate';
import styles from './ProfileMenu.module.css';

function UserIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12zm0 2c-3.7 0-8 1.9-8 5v1h16v-1c0-3.1-4.3-5-8-5z" />
    </svg>
  );
}

function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M3 8l4.5 3.5L12 5l4.5 6.5L21 8l-1.7 9.5a1 1 0 0 1-1 .8H5.7a1 1 0 0 1-1-.8z" />
    </svg>
  );
}

/** The stroked line icons the rows use. 24x24, 1.7, currentColor. */
const ICON = {
  home: <path d="M3 10.5 12 3l9 7.5M5 9.5V20h14V9.5" />,
  swords: <path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4" />,
  cards: <path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8 9h8v6H8z" />,
  folder: <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />,
  book: <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" />,
  console: <path d="M4 6h16M4 12h16M4 18h10" />,
  sun: <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />,
  moon: <path d="M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5z" />,
  out: <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" />,
};

function Glyph({ d }: { d: keyof typeof ICON }) {
  return (
    <span className={styles.itemIcon}>
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {ICON[d]}
      </svg>
    </span>
  );
}

interface MenuPos {
  top: number;
  right: number;
}

/**
 * The account dropdown.
 *
 * ── THE SCHEME ───────────────────────────────────────────────────────────
 *
 * Redrawn to the reference layout: an identity block, one filled row for the
 * tier, then the destinations in GROUPS separated by rules rather than one
 * undifferentiated list, and a red row on its own at the bottom. The hovered
 * row lifts as a raised card instead of taking a wash, which is the detail
 * that makes the whole thing read as a stack of cards rather than a list.
 *
 * Grouping is the substantive part. The old menu was nine rows in a column
 * with two dividers placed by accident of order; these are three groups that
 * answer three different questions — where can I go, what can I read, and how
 * does this look — and the log out sits outside all of them because it is the
 * only row that ends the session.
 *
 * ── THE THEME ROW IS A SWITCH NOW ────────────────────────────────────────
 *
 * It was a menu item labelled "Light mode" that changed the theme when
 * clicked: an ACTION named after the state it would produce, which is the
 * opposite convention from the switch every other screen uses. It is that same
 * switch here, smaller, so the row states what the theme IS.
 *
 * The row itself is a `<div>`, not a button. The switch owns the click, and
 * nesting a control inside a control double-fires it — the same trap the Duel
 * Zone's `.gameRow` hit with a button inside a button.
 */
export function ProfileMenu({ triggerClassName }: { triggerClassName: string }) {
  /* TWO STORES, AND THE MENU MUST FOLLOW THE ONE IN CHARGE.
     There is ONE store now. `authStore` and its twenty bundled accounts are
     deleted; this used to read both, and a Log out wired to the retired one
     cleared a store nothing read, so the click did visibly nothing. */
  const account = useAccountStore((s) => s.profile);
  /* THE ACCESS LEVEL, NOT THE RAW STORE TIER, and the difference is not
     academic: `accountStore` initialises `tier` to 'free' and RESETS it to
     'free' on sign-out, so a visitor who has never signed in reads as free
     here. That was harmless while `TierBadge` rendered nothing for free — the
     moment free started wearing MEMBER, this menu would have handed a
     signed-out stranger a membership badge. `useAccess()` is the one function
     that knows 'anon' is not a tier, and it is what the top bar already reads,
     so the two badges in the shell now come from the same answer. */
  const tier = useAccess();
  /* The same source the top bar's badge reads, so the two instances of one
     component cannot disagree about how many days are left. */
  const daysLeft = trialDaysLeft(useAccountStore((s) => s.profile));
  const accountEmail = useAccountStore((s) => s.email);
  const accountSignOut = useAccountStore((s) => s.signOut);

  const authUser = account?.display_name ?? accountEmail ?? null;

  function logout() {
    void accountSignOut();
  }
  const theme = useThemeStore((s) => s.theme);
  const library = useBuilderStore((s) => s.library);
  const homeDecks = useBuilderStore((s) => s.sets.home.decks);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const [contact, setContact] = useState(false);
  const open = pos !== null;

  function toggleOpen() {
    if (open) {
      setPos(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ top: rect.bottom + 10, right: Math.max(12, window.innerWidth - rect.right) });
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setPos(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setPos(null);
    }
    function onResize() {
      setPos(null);
    }
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  function go(hash: string) {
    setPos(null);
    window.location.hash = hash;
  }

  const paid = tier === 'pro' || tier === 'admin';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        data-metal
        data-open={open || undefined}
        title={`Signed in as ${authUser ?? 'guest'}`}
        aria-label="Profile menu"
        aria-expanded={open}
        onClick={toggleOpen}
      >
        <UserIcon />
      </button>

      {createPortal(
        open && pos ? (
          <div className={styles.menu} style={{ top: pos.top, right: pos.right }} role="menu">
            <div ref={menuRef}>
              {/* ── IDENTITY ────────────────────────────────────────────
                  Name over email. The email is back: this slot used to hold
                  the literal string "Test account" from the deleted gate, and
                  on a site where one person may hold several accounts it is
                  the only line that says WHICH one is signed in. */}
              <div className={styles.identity}>
                <span className={styles.bigAvatar}>
                  <UserIcon size={20} />
                </span>
                <div className={styles.identityText}>
                  <span className={styles.username}>{authUser}</span>
                  {accountEmail && <span className={styles.email}>{accountEmail}</span>}
                </div>
              </div>

              {/* ── THE TIER ROW ───────────────────────────────────────
                  Three readings of one row, decided by what the account has:

                    free / member   Upgrade profile        (a link)
                    pro             Pro Mode Activated     (a statement)
                    admin           Admin Mode Activated   (a statement)

                  Title case, from `TIER_LABEL` unaltered. Shouting the tier
                  set it apart from every other line in the menu for no reason
                  — the badge beside it is already doing the emphasis, in caps,
                  and two things shouting is one too many.

                  Free sits with member rather than getting a fourth wording:
                  both of them are accounts that could upgrade, which is the
                  only thing this row is asking, and BOTH ARE MEMBERS — the
                  trial is an access window, not a different kind of person, so
                  the badge does not change when it ends.
                  Free and Member get an upgrade — the only thing in this menu
                  that should be loud, so it takes the filled treatment. Pro
                  and Admin get the same row as a statement with nothing to
                  click: offering Pro to someone who has it is how a product
                  tells you it is not listening. */}
              {paid ? (
                <div className={styles.tierRow} data-tier={tier}>
                  <span className={styles.tierIcon}>
                    <CrownIcon />
                  </span>
                  <span className={styles.tierLabel}>
                    {TIER_LABEL[tier as Exclude<typeof tier, 'anon'>]} Mode Activated
                  </span>
                  {/* THE REAL BADGE, not a flat pill printed to look like one.
                      It is the same liquid button the top bar wears, at the
                      size this row has room for — so the thing that states
                      your tier is one component with one appearance wherever
                      it shows up, and it reacts here exactly as it does
                      there. */}
                  <TierBadge tier={tier} width={68} height={24} />
                </div>
              ) : (
                /* IT WENT TO `#/signin`, WHICH IS THE WRONG ANSWER TWICE
                   OVER: this row is only ever shown to somebody who IS signed
                   in, so it sent them back to a form they had already filled
                   in, and it said nothing about how Pro is actually obtained.
                   Every upgrade in the app ends in the same dialog now. */
                <button
                  type="button"
                  className={styles.tierRow}
                  data-tier="upgrade"
                  role="menuitem"
                  onClick={() => {
                    setPos(null);
                    setContact(true);
                  }}
                >
                  <span className={styles.tierIcon}>
                    <CrownIcon />
                  </span>
                  <span className={styles.tierLabel}>Upgrade profile</span>
                  {/* THE BADGE IS WHAT YOU ARE, NOT WHAT IS BEING SOLD.
                      It was forced to `pro` here, from when `TierBadge`
                      rendered nothing for a free account and the row would
                      otherwise have been bare. The result was that a member
                      opening their own menu saw a PRO badge on it and read it
                      as their status — the row says "Upgrade profile" a
                      centimetre to the left, and a badge is still the louder
                      of the two. It reads the account now, like every other
                      instance of it does. */}
                  <TierBadge tier={tier} trialDaysLeft={daysLeft} width={68} height={24} />
                </button>
              )}

              {/* The two figures, and each one goes to the thing it counts.
                  They were static text, which is the wrong instinct for a
                  number in a menu: it names a place, someone will point at it,
                  and a count that cannot be opened is a dead end two rows above
                  the row that opens it anyway. Saved sets live under the duel
                  builder and home decks are Deck's Home, so each tile is the
                  short way to its own screen. */}
              <div className={styles.stats}>
                <button
                  type="button"
                  className={styles.stat}
                  role="menuitem"
                  title="Open the duel builder"
                  onClick={() => go('#/builder')}
                >
                  <span className={styles.statValue}>{library.length}</span>
                  <span className={styles.statLabel}>Saved duel sets</span>
                </button>
                <button
                  type="button"
                  className={styles.stat}
                  role="menuitem"
                  title="Open Deck&apos;s Home"
                  onClick={() => go('#/decks')}
                >
                  <span className={styles.statValue}>{homeDecks.length}</span>
                  <span className={styles.statLabel}>Home decks</span>
                </button>
              </div>

              {/* ── GROUP: where you can go ─────────────────────────── */}
              <div className={styles.group}>
                <button type="button" className={styles.item} role="menuitem" onClick={() => go('')}>
                  <Glyph d="home" />
                  Home
                </button>
                <button
                  type="button"
                  className={styles.item}
                  role="menuitem"
                  onClick={() => go('#/builder')}
                >
                  <Glyph d="swords" />
                  Royal Duels
                </button>
                <button
                  type="button"
                  className={styles.item}
                  role="menuitem"
                  onClick={() => go('#/decks')}
                >
                  <Glyph d="cards" />
                  Deck&apos;s Home
                </button>
                <button
                  type="button"
                  className={styles.item}
                  role="menuitem"
                  onClick={() => go('#/palette')}
                >
                  <Glyph d="folder" />
                  Counter Palette
                </button>
              </div>

              {/* ── GROUP: what you can read, and the console for those who
                  have one. Only admins are offered it; the route and the
                  database both refuse everyone else anyway, so this just
                  avoids showing a door that does not open. */}
              <div className={styles.group}>
                <a className={styles.item} role="menuitem" href="#/guide" onClick={() => setPos(null)}>
                  <Glyph d="book" />
                  Field Book
                </a>
                {tier === 'admin' && (
                  <a
                    className={styles.item}
                    role="menuitem"
                    href="#/admin"
                    onClick={() => setPos(null)}
                  >
                    <Glyph d="console" />
                    Console
                  </a>
                )}
              </div>

              {/* ── GROUP: how it looks ─────────────────────────────── */}
              <div className={styles.group}>
                {/* THE WORD IS ON THE ROW, NOT IN THE SWITCH. The toggle ships
                    with DARK/LIGHT printed on its own cap, which is right at
                    the sizes the top bar and the tool headers use it and is a
                    cramped, shouting duplicate here — the row already has a
                    label column, so the name belongs in it. `hideWord` drops
                    it from the cap and keeps the glyph — a prop rather than a
                    CSS override, because the override would have been a
                    class-name substring and those are hashed in a production
                    build.

                    It reads the STATE, matching the switch's own convention
                    everywhere else: "Dark Mode" while dark is on, not while
                    clicking would turn it on. */}
                <div className={styles.switchRow}>
                  <Glyph d={theme === 'dark' ? 'moon' : 'sun'} />
                  <span className={styles.switchLabel}>
                    {theme === 'dark' ? 'Dark' : 'Light'} Mode
                  </span>
                  <ThemeToggle size="1.05rem" hideWord className={styles.switchControl} />
                </div>
              </div>

              <button
                type="button"
                className={`${styles.item} ${styles.itemDanger}`}
                role="menuitem"
                onClick={() => {
                  setPos(null);
                  logout();
                }}
              >
                <Glyph d="out" />
                Log out
              </button>
            </div>
          </div>
        ) : null,
        document.body,
      )}

      {/* OUTSIDE THE MENU'S PORTAL, and it has to be: the dialog is opened by
          closing the menu, so anything rendered inside that portal would
          unmount in the same click that asked for it. `ProContact` portals
          itself to `document.body` anyway, for the backdrop-filter reason every
          dialog here does. Living on the menu rather than on each of its four
          hosts means the builder, Deck's Home, the Counter Hub and the
          dashboard all get it without knowing about it. */}
      {contact && <ProContact onClose={() => setContact(false)} />}
    </>
  );
}
