/**
 * THE FIELD BOOK — what this site is, as nine plates.
 *
 * ── DROPPING THE ARTWORK IN ──────────────────────────────────────────────
 * Every illustrated plate names one image in `art.file`. Put the PNG at
 *
 *     public/assets/guide/<file>.png
 *
 * and it appears — there is nothing else to wire, no manifest to update and no
 * import to add. Until the file exists the slot draws its own ruled frame
 * carrying the plate's brief, so the book is complete, turnable and readable
 * before a single drawing arrives.
 *
 * `brief` is the prompt the plate is asking for, kept BESIDE the slot it fills
 * rather than in a list somewhere else that would drift away from it.
 *
 * ── AND WHY THE ACCESS PLATE IS NOT WRITTEN DOWN ─────────────────────────
 * Every verdict on the access plate is computed by `sectionAllowed()`, the same
 * function the router gates on, so this page cannot drift from the product the
 * way a hand-maintained pricing table always eventually does. If the carve-out
 * moves, the plate moves with it and nobody has to remember. Same rule the
 * closing band already follows: counted at render time, never typed in.
 */
import type { ReactNode } from 'react';
import { CARDS } from '../../data/cards';
import { FREE_SECTIONS, PRO_ONLY_SECTIONS, sectionAllowed, type Access } from '../../state/tiers';

/** The nine analytics areas, in rail order. */
export const AREAS = [
  { label: 'Search Player', blurb: 'The tag overview behind the hero search — decks, use and win rates, trends.' },
  { label: 'Recent Battles', blurb: 'Every stored battle, newest first. Their deck against the one they faced.' },
  { label: 'Top Meta Decks', blurb: 'What the whole player base is running, ranked by use rate.' },
  { label: 'Deck Analysis', blurb: 'Elixir curve, cycle, role coverage and the matchup spread for one deck.' },
  { label: 'Duel Analysis', blurb: 'Which two cards you actually rebuild around, across duel play.' },
  { label: 'Duel Zone', blurb: 'The Bo3 and Bo5 series log, and which decks follow each opener.' },
  { label: 'Cards', blurb: `Use and win rate for all ${CARDS.length} cards — an evolved card scored apart from a plain one.` },
  { label: 'Deck Counter', blurb: 'What beats you, a head-to-head between two decks, and what answers a given deck.' },
  { label: 'Coach Assist', blurb: 'Mid-duel: what they will bring next, and which of your decks answers it.' },
] as const;

/**
 * A tripwire, not a formality. These labels are STRINGS matched against the
 * gate's own lists, so a rename on one side and not the other would quietly
 * turn a free area into a locked one on this page and nowhere else — a wrong
 * answer that renders perfectly.
 */
const LABELS = new Set<string>(AREAS.map((a) => a.label));
export const UNKNOWN_GATED = [...FREE_SECTIONS, ...PRO_ONLY_SECTIONS].filter((s) => !LABELS.has(s));

export const COLUMNS: { access: Access; head: string; note: string }[] = [
  { access: 'anon', head: 'Visitor', note: 'never signed in' },
  { access: 'free', head: 'Member', note: 'signed up · three days spent' },
  { access: 'trial', head: 'Member', note: 'first three days' },
  { access: 'pro', head: 'Pro', note: 'paid' },
];

export type PlateArt = {
  /** `public/assets/guide/<file>.png`. Absent file → the placeholder. */
  file: string;
  alt: string;
  /** What to draw. Kept beside the slot so the two cannot drift apart. */
  brief: string;
  /** The line under the plate. A field book labels its drawings. */
  caption?: string;
  /** True once the drawing exists, so the index can say what is still open. */
  supplied?: boolean;
};

export type Plate = {
  id: string;
  title: string;
  tab: string;
  date: string;
  /** `spread` — art across both leaves. `split` — art left, prose right. */
  layout: 'spread' | 'split' | 'text';
  art?: PlateArt;
  left?: ReactNode;
  right?: ReactNode;
  /** Overlaid on a spread plate, in the lower corner. */
  legend?: ReactNode;
};

const Kicker = ({ children }: { children: ReactNode }) => <p className="pl-kicker">{children}</p>;
const Body = ({ children }: { children: ReactNode }) => <p className="pl-body">{children}</p>;

function Matrix() {
  return (
    <table className="pl-matrix">
      <thead>
        <tr>
          <th scope="col" className="pl-area">Area</th>
          {COLUMNS.map((c) => (
            <th scope="col" key={c.access}>
              <span className="pl-th">{c.head}</span>
              <span className="pl-thNote">{c.note}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {AREAS.map((a) => (
          <tr key={a.label}>
            <th scope="row" className="pl-area">{a.label}</th>
            {COLUMNS.map((c) => {
              const open = sectionAllowed(c.access, a.label);
              return (
                <td key={c.access} data-open={open ? 'yes' : 'no'}>
                  <span aria-hidden="true">{open ? '●' : '○'}</span>
                  <span className="pl-sr">{open ? 'included' : 'not included'}</span>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const PLATES: Plate[] = [
  {
    id: 'cover',
    title: 'Deckkies',
    tab: 'Cover',
    date: 'PLATE I',
    layout: 'spread',
    art: {
      file: 'cover-arena',
      alt: 'A watercolour panorama of the arena, the river and the ships, drawn across both pages',
      supplied: true,
      brief:
        'The king and his knight and archer on a headland, looking out over the river to the far keep, ships on the water. Splashed watercolour, full colour, on white paper.',
    },
    legend: (
      <>
        <h1 className="pl-plateTitle">Deckkies</h1>
        <p className="pl-plateSub">
          A Clash Royale companion in two halves — tools for building decks, and
          a measured account of what happens when they are played.
        </p>
      </>
    ),
  },

  {
    id: 'what',
    title: 'What it is',
    tab: 'I · What it is',
    date: 'PLATE II',
    layout: 'split',
    art: {
      file: 'the-village',
      caption: 'The kingdom seen whole — one place made of many connected parts.',
      alt: 'A watercolour village of pagodas on cliffs joined by rope bridges at sunset',
      supplied: true,
      brief:
        'A village of pagodas on separate cliffs, joined by rope bridges, under a sunset. One place made of many connected parts — which is what the site is.',
    },
    right: (
      <>
        <Kicker>Plate II</Kicker>
        <h2 className="pl-h">Two halves, one shell</h2>
        <Body>
          One half is a workshop: build a duel collection, keep a vault of single
          decks, sort counters into folders. The other reads a battle database
          and tells you what those decks actually did.
        </Body>
        <dl className="pl-defs">
          <div>
            <dt>The database</dt>
            <dd>Millions of stored battles, read strictly read-only, beside the collector that writes it.</dd>
          </div>
          <div>
            <dt>The card list</dt>
            <dd>{CARDS.length} cards, vendored rather than hotlinked, with evolution and hero art.</dd>
          </div>
          <div>
            <dt>The window</dt>
            <dd>Every figure is measured over a range you choose — counted back from that player's last battle, not from today.</dd>
          </div>
        </dl>
      </>
    ),
  },

  {
    id: 'tools',
    title: 'The three tools',
    tab: 'II · Tools',
    date: 'PLATE III',
    layout: 'split',
    art: {
      file: 'the-workshop',
      caption: 'Every deck is a recipe before it is a result.',
      alt: 'A watercolour spellbook open on a workbench among candles, potions and a mortar',
      supplied: true,
      brief:
        'An open spellbook on a workbench among candles, phials and a bubbling pot — recipe pages, hand-lettered, working out what a card becomes. The place a deck is MADE, before it is ever played.',
    },
    right: (
      <>
        <Kicker>Plate III</Kicker>
        <h2 className="pl-h">The workshop</h2>
        <dl className="pl-defs">
          <div>
            <dt>Duel Builder</dt>
            <dd>Five decks of eight, no card twice across the whole collection.</dd>
          </div>
          <div>
            <dt>Deck Vault</dt>
            <dd>Unlimited single decks that save themselves as you build, filtered by win condition.</dd>
          </div>
          <div>
            <dt>Counter Hub</dt>
            <dd>Archetype folders, so the answer to Golem is somewhere you can find it again.</dd>
          </div>
        </dl>
        <p className="pl-note">
          Paste a deck link and the deck appears in its real slot order. Copy a
          link, or open it straight in the game, from every screen that draws one.
        </p>
      </>
    ),
  },

  {
    id: 'duel',
    title: 'How a duel works',
    tab: 'III · The duel',
    date: 'PLATE IV',
    layout: 'split',
    art: {
      file: 'the-duel',
      caption: 'Three decks, and no card twice across any of them.',
      alt: 'A watercolour duel in a bamboo grove',
      supplied: true,
      brief:
        'A duel under way in a bamboo grove over a lily pond — one fighter launched through the air, another braced on a rock, water thrown up where the last one landed.',
    },
    right: (
      <>
        <Kicker>Plate IV</Kicker>
        <h2 className="pl-h">How a duel works</h2>
        <Body>
          A duel loadout is three decks that <b>cannot share a card</b>. That one
          rule is what makes any of this predictable: every deck revealed removes
          eight cards from what can still be brought.
        </Body>
        <dl className="pl-defs">
          <div>
            <dt>The three special seats</dt>
            <dd>Slot one takes an evolution, slot two a hero or champion, slot three either — the wild seat.</dd>
          </div>
          <div>
            <dt>Two, two, and three</dt>
            <dd>At most two evolutions, at most two heroes, and three marks in total. One per seat.</dd>
          </div>
          <div>
            <dt>The four ambiguous cards</dt>
            <dd>Knight, Valkyrie, Musketeer and Wizard have both forms, so a pasted link cannot say which was meant. The builder asks, and shows you both pictures.</dd>
          </div>
        </dl>
      </>
    ),
  },

  {
    id: 'areas',
    title: 'The nine areas',
    tab: 'IV \u00b7 Areas',
    date: 'PLATE V',
    layout: 'split',
    art: {
      file: 'the-reading-room',
      caption: 'Nine ways of watching, none of them a fight.',
      alt: 'A watercolour barbarian reading from a deckchair while a battle goes on behind him',
      supplied: true,
      brief:
        'A barbarian in a deckchair with a coconut, sandcastle and a barrel of gold beside him, while a battle carries on down the beach. The reading room: watching the game rather than playing it.',
    },
    right: (
      <>
        <Kicker>Plate V</Kicker>
        <h2 className="pl-h">The reading room</h2>
        <ul className="pl-areas pl-areas--tight">
          {AREAS.map((a) => (
            <li key={a.label}>
              <b>{a.label}</b>
              <span>{a.blurb}</span>
            </li>
          ))}
        </ul>
      </>
    ),
  },

  {
    id: 'access',
    title: 'Who may open what',
    tab: 'V \u00b7 Access',
    date: 'PLATE VI',
    layout: 'split',
    art: {
      file: 'the-crowd',
      caption: 'Everyone is in the arena. Not everyone has the same seat.',
      alt: 'A watercolour champion raising his arms before a packed, floodlit arena crowd',
      supplied: true,
      brief:
        'A champion with both arms raised before a packed arena under spotlights, the crowd on their feet. Everyone is in the building; what differs is where you are sitting.',
    },
    right: (
      <>
        <Kicker>Plate VI</Kicker>
        <h2 className="pl-h">Who may open what</h2>
        <Matrix />
        <p className="pl-note">
          The site is public and the gate is per-feature — a visitor lands on the
          product and only meets it when they reach for something their tier does
          not include. <b>A visitor and a lapsed member get the same areas,
          deliberately.</b> This table is computed from the same function the site
          gates on, so it cannot fall out of step with what you are actually shown.
        </p>
      </>
    ),
  },

  {
    id: 'tiers',
    title: 'Member and Pro',
    tab: 'VI · Member & Pro',
    date: 'PLATE VII',
    layout: 'split',
    art: {
      /* RENAMED FROM `the-gate`. The brief asked for a two-arched gatehouse and
         what was drawn is the arena under mountains of gold — which carries
         "what a subscription is for" better than a door would have. The slot is
         renamed to the picture that exists rather than left with a caption
         claiming a gate nobody painted. */
      file: 'the-treasury',
      caption: 'The arena, and everything the reading of it is worth.',
      alt: 'A watercolour arena seen from above, ringed by mountains of gold and gems',
      supplied: true,
      brief:
        'The arena from above, towers and troops mid-battle, ringed by heaped gold and gems. What the deeper reading of the game is actually worth.',
    },
    right: (
      <>
        <Kicker>Plate VII</Kicker>
        <h2 className="pl-h">Member and Pro</h2>
        <dl className="pl-defs">
          <div>
            <dt>Member — the first three days</dt>
            <dd>Everything a Pro has, except the one carve-out. It expires on time on its own; nothing has to run.</dd>
          </div>
          <div>
            <dt>Member — after that</dt>
            <dd>{FREE_SECTIONS.length} areas, permanently: {FREE_SECTIONS.join(', ')}. Every deck tool, every paste box, every copy-and-open link. Signing up is what makes you a member; the three days are an access window on top of it, so the badge does not go away when they do.</dd>
          </div>
          <div>
            <dt>Pro — paid</dt>
            <dd>All {AREAS.length} areas, {PRO_ONLY_SECTIONS.join(' and ')} included, plus the PDF export.</dd>
          </div>
        </dl>
        <p className="pl-note">
          <b>{PRO_ONLY_SECTIONS.join(' and ')} is the only thing Member does not open.</b>{' '}
          It is the deep end, and the reason to subscribe rather than a sample of
          what subscribing is like.
        </p>
      </>
    ),
  },

  {
    id: 'numbers',
    title: 'Where the numbers come from',
    tab: 'VII · The numbers',
    date: 'PLATE VIII',
    layout: 'split',
    art: {
      file: 'the-archive',
      caption: 'The quiet place where things are counted.',
      alt: 'A watercolour shrine over a still pond, with a stair rising behind it',
      supplied: true,
      brief:
        'A quiet shrine over a still pond, a stone stair rising behind the gate, lanterns and crystals in the water. The calm place where things are counted.',
    },
    right: (
      <>
        <Kicker>Plate VIII</Kicker>
        <h2 className="pl-h">Where the numbers come from</h2>
        <Body>
          Every figure on this site is counted from stored battles, over a window
          you choose. Nothing is modelled, estimated or filled in.
        </Body>
        <dl className="pl-defs">
          <div>
            <dt>An evidence floor</dt>
            <dd>A win rate needs eight games behind it before it is ranked. Under that it is marked thin and stays unranked.</dd>
          </div>
          <div>
            <dt>The rung is printed</dt>
            <dd>When a matchup cannot be read off your exact list it widens — one card different, then two, then the archetype — and says which reading answered.</dd>
          </div>
          <div>
            <dt>Symmetrised</dt>
            <dd>Tracked players win more than they lose, so a raw table says everything beats everything. Every mirror lands at exactly 50%, which is the proof the correction is right.</dd>
          </div>
        </dl>
      </>
    ),
  },

];

/** What the index shows as still outstanding. */
export const MISSING_ART = PLATES.filter((p) => p.art && !p.art.supplied).map((p) => p.art!.file);
