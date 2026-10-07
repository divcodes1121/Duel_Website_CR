/**
 * WHAT'S NEW — the release feed behind the bell in the top bar.
 *
 * NO IMPORTS, DELIBERATELY, the same rule `tiers.ts`, `utils/format.ts`,
 * `state/passwordRules.ts` and `utils/squadParse.ts` follow. This decides what
 * every account is told the product does, and the unread arithmetic decides
 * whether they are told at all — both have to be importable by a test without
 * dragging in a Supabase client that wants a native WebSocket.
 *
 * ── IT IS A FILE, NOT A TABLE ─────────────────────────────────────────────
 *
 * There is no admin screen for this and no row in the database. A release note
 * ships in the same commit as the thing it describes, which is the only
 * arrangement where the two cannot drift: a feature cannot go out unannounced,
 * and an announcement cannot go out for a feature that was reverted. It also
 * costs nothing — no request, no table, no migration — and it is reviewable in
 * a diff like everything else.
 *
 * The cost is that a note cannot be published without a deploy. For a site
 * that deploys from `main` in about two minutes, that is not a cost.
 *
 * ── HOW TO ADD ONE ────────────────────────────────────────────────────────
 *
 *   1. Put it at the TOP of `RELEASES`. The array is newest first and
 *      `unreadCount` reads position, not dates — see the note there.
 *   2. Give it an id that is never reused, and never edit an old one's id.
 *      An id is what a reader's "seen" mark points at; changing one re-notifies
 *      everybody about something they have already read.
 *   3. Write it for somebody who does not know the codebase. "The suggestion
 *      window advances the duel" is a commit subject; "you no longer lose your
 *      pasted decks when a game ends" is a release note.
 *   4. **Never put a figure in it that is not measured.** Same rule as the
 *      landing page's closing band, and for the same reason: this is the one
 *      surface that speaks to every account at once, so an invented number
 *      here is a claim the whole user base is asked to believe.
 */

/** What kind of change this is. Drives a word and a hue, never a filter. */
export type ReleaseKind = 'new' | 'improved' | 'fixed';

export interface Release {
  /**
   * Stable and never reused. This is what a reader's "seen" mark points at, so
   * editing one re-notifies everybody about something they have already read.
   */
  id: string;
  /** ISO day, for display. Ordering comes from the array, not from this. */
  date: string;
  kind: ReleaseKind;
  /** A sentence, not a commit subject. Shown in the list and read first. */
  title: string;
  /**
   * One or two short paragraphs. PLAIN TEXT — no markup, no HTML, nothing to
   * sanitise. A changelog that renders markup is a changelog that has to be
   * trusted, and this one is rendered into every signed-in reader's chrome.
   */
  body: string[];
  /** A hash route to go and look at it, if there is somewhere to look. */
  href?: string;
  /** The link's words. Required whenever `href` is set. */
  hrefLabel?: string;
  /**
   * Which tier this needs, when it needs one.
   *
   * A LABEL, NOT A FILTER. Everybody sees every entry, including things their
   * tier cannot open — a feed that hides what you cannot have is a feed that
   * quietly shrinks the product, and the whole argument for subscribing is
   * knowing what is behind the gate. The badge is how it stays honest.
   */
  needs?: 'trial' | 'pro';
}

/**
 * Newest first. **The order of this array is the chronology**, and
 * `unreadCount` reads position rather than parsing dates — two notes can share
 * a day, and a date comparison would then have to break the tie by something
 * that is not the order they were written in.
 *
 * `tests/releases.test.ts` asserts the dates are non-increasing down the list,
 * so an entry inserted in the wrong place is caught rather than silently
 * mis-counting everybody's unread badge.
 */
export const RELEASES: Release[] = [
  {
    id: '2026-10-07-duel-plan',
    date: '2026-10-07',
    kind: 'improved',
    title: 'Coach Assist picks for the duel, not just the next game',
    body: [
      'A duel is the first to two of three and no card is played twice, so the deck with the best matchup now is not always the one to bring now. The Suggestion now values each of your decks by the chance of winning the duel: what it leaves you for the games after, against what your opponent is then likely to bring. On ten thousand duels it had never seen, that order won a little more often than taking the best deck for each game (51.4% against 50.8%; the order players really used won 49.0%).',
      'After game 1 it asks one question: who won it. One up you need one of the next two, one down you need both, and a player who has just won a game wins the next one more often than the matchups alone say. “Play this” shows the chance of winning the duel, with this game’s beside it.',
      'Under the pick is the deck to bring next if you win and if you lose, so the next choice is ready before the game ends.',
    ],
    needs: 'pro',
  },
  {
    id: '2026-10-07-built-decks-make-sense',
    date: '2026-10-07',
    kind: 'fixed',
    title: 'Decks Deckkies builds have to make sense as decks',
    body: [
      'Under a Coach Assist suggestion, “Deckkies built for this duel” could change two cards in a real deck and end up with something nobody would play — a bait deck with Freeze and Arrows and no Log. Each change was one real players make; the deck after both was never checked.',
      'Now every deck Deckkies builds or changes is checked whole: its spell package, its buildings and each support card against what duel players actually field with that win condition, and how well its cards go together. A change may not leave a deck stranger than it found it. On real pairs, three in four of the decks it used to build failed that check; none do now.',
    ],
    needs: 'pro',
  },
  {
    id: '2026-10-07-duel-read',
    date: '2026-10-07',
    kind: 'improved',
    title: 'Coach Assist reads the order of a duel, and shows what they have left',
    body: [
      'The decks Coach Assist expects your opponent to bring now come from the order they play their duels in and how recently they played each deck, not from a count of plays. On duels it had never seen, it named the exact opening deck first about twice as often as before.',
      'Under their likely decks there is a new block: the win conditions, spells, buildings and support cards they may still bring, with the chance of each, and the cards they have already spent this duel in grey. The figure beside each of their decks is now the real chance, and a “new deck” figure says how likely they are to bring something not seen in the window.',
      'Next to the History days there is a Duel switch. Choose Clan war or Friendly if you know which it is — players change decks far more in friendly duels, and the read allows for it.',
    ],
    needs: 'pro',
  },
  {
    id: '2026-10-06-electro-forms',
    date: '2026-10-06',
    kind: 'new',
    title: 'Hero Electro Wizard and Evolution Electro Giant are in the deck tools',
    body: [
      'Two cards gained a new form. Electro Wizard can now go in the Hero slot and Electro Giant in the Evolution slot, in Royal Duels, Deck’s Home and the Counter Palette, and each is drawn in its new art there.',
      'You will find them under the Heroes and Evos filters in the card library, and on the Heroes and Evolutions tabs of the Cards screens.',
    ],
    href: '#/builder',
    hrefLabel: 'Open Royal Duels',
  },
  {
    id: '2026-10-04-player-decks',
    date: '2026-10-04',
    kind: 'new',
    title: 'Decks: every deck a player is using, most played first',
    body: [
      'Search a player and open Decks in the sidebar. It lists every deck they played in the last 7, 14 or 30 days, in order of how often they play it, with the eight cards, the average elixir, the four-card cycle and the share of their games it was.',
      'Each deck shows two records side by side: the player’s own wins, draws and losses with it, and the same deck’s record across all players. It is open to everyone, and it is part of the PDF export.',
    ],
    href: '#/',
    hrefLabel: 'Search a player',
  },
  {
    id: '2026-10-03-hide-duel-deck',
    date: '2026-10-03',
    kind: 'new',
    title: 'Hide a duel deck to use its cards in another one',
    body: [
      'Every deck in Royal Duels has an eye button now. Press it and the deck turns grey: it stays where it is, and its cards become free for your other decks, so you can build a second version of a deck without taking the first one apart. Add a deck slot if you need room for it.',
      'Press the eye again to bring the deck back. If two decks then hold the same card, the newer deck shows it in black and white until you swap one of the two. Hidden decks are saved with the set and are left out of the PDF report.',
    ],
    href: '#/builder',
    hrefLabel: 'Open Royal Duels',
  },
  {
    id: '2026-10-03-pdf-names',
    date: '2026-10-03',
    kind: 'fixed',
    title: 'PDFs print Japanese and Cyrillic player names, with the name in Latin letters beside them',
    body: [
      'A player whose name is written in Japanese or Cyrillic used to appear in every PDF as their tag. The name now prints as it is written, and where a report lists its players it is followed by the same name in Latin letters and the tag, for example こっとん (Kotton) · #ABC002.',
      'Names in kanji print as written without a Latin form, because a kanji name cannot be read reliably by rule. Korean names still print as the tag.',
    ],
    href: '#/teams',
    hrefLabel: 'Export a scouting report',
  },
  {
    id: '2026-10-03-scroll-rail',
    date: '2026-10-03',
    kind: 'new',
    title: 'Every screen has a new scroller: a rail of ticks you can drag, press and read',
    body: [
      'The plain scrollbar is gone. Down the right edge of anything that scrolls there is now a rail of ticks standing for the whole page, and the lit violet run is the part you are looking at. Drag the lit run to scrub, or press anywhere on the rail to go there. The mouse wheel, the keyboard and touch scrolling work exactly as before.',
      'Move the pointer toward the rail and the ticks rise to meet it. The longer ticks are the page’s own sections: point at one to see its name, press it to jump there. On a phone the rail shows while the page moves and fades when it stops.',
    ],
    href: '#/',
    hrefLabel: 'Try it on the home page',
  },
  {
    id: '2026-10-02-build-around-your-cards',
    date: '2026-10-02',
    kind: 'new',
    title: 'Coach Assist can build around the cards you want to play',
    body: [
      'Under “Play this” on a Coach Assist suggestion there is now a card picker. Pick up to four cards or win conditions, press Find decks, and every deck that comes back holds all of them, with your win chance against this opponent and against each of their likely decks.',
      'Decks that real duel players field come first, then your own decks and the meta’s, then decks Deckkies builds around your cards. Where swapping a card raises your chance, the swap is shown with the new figure. The first search for a pair of players can take a few seconds.',
    ],
    needs: 'pro',
  },
  {
    id: '2026-10-02-recent-battles-rows',
    date: '2026-10-02',
    kind: 'improved',
    title: 'Recent Battles has a cleaner row: both players, both decks, less scrolling',
    body: [
      'Each battle is now one compact card. Your side is tinted blue and your opponent’s red, each with the player’s name and tag, the deck as two rows of four cards, its average elixir and its name. The big VS in the middle is gone; a small one sits on the line between the two decks.',
      'The opponent’s tag is printed under their name, so you can read it off and look them up. The copy link, save picture and open in game buttons are larger, and on a phone a long deck name wraps instead of being cut off.',
    ],
  },
  {
    id: '2026-09-28-card-inspect-and-tabs',
    date: '2026-09-28',
    kind: 'improved',
    title: 'Tap any card to see it up close, and every set of tabs now works the same way',
    body: [
      'Tap or click a card almost anywhere on the site and it opens large, tilting toward your pointer, with its evolution or hero form a tap away and its description underneath. From the Cards screens it also shows the figures that screen measured for it.',
      'Every screen with tabs now uses one control that slides between them, scrolls sideways on a phone when there are too many to fit, and works with the arrow keys. Moving between screens fades instead of flashing, and on a phone the deck buttons on Duel Zone and Deck Counter moved under the cards so the cards have room.',
    ],
    href: '#/',
    hrefLabel: 'Open Deckkies',
  },
  {
    id: '2026-09-28-deck-image-and-fill',
    date: '2026-09-28',
    kind: 'new',
    title: 'Save any deck as a picture, let the builder finish a deck for you, and see how the meta moved',
    body: [
      'Every deck on the site now has a picture button next to Copy link: it saves the deck as an image with its cards, average elixir and curve, ready for Discord or a group chat. On a phone it opens the share sheet.',
      'The wand on a deck in Royal Duels, Deck’s Home or Counter Palette fills the empty slots with a legal deck: an evolution, a hero, a win condition and a spell, at a sensible average cost, and never a card another duel deck already holds. On an empty deck it builds one from scratch, and Undo takes it back. Each deck’s footer now draws its elixir curve. Top Meta Decks will mark each deck’s climb or fall once a week of daily history is stored; until then it says how many days it has.',
    ],
    href: '#/builder',
    hrefLabel: 'Open Royal Duels',
  },
  {
    id: '2026-09-28-palette-and-undo',
    date: '2026-09-28',
    kind: 'new',
    title: 'Press Ctrl K to jump anywhere, and undo any change to your decks',
    body: [
      'Ctrl K (⌘K on a Mac) or / opens a search box that reaches every screen, every deck tool, your recent players and any player tag you type. Press ? to see every keyboard shortcut — G then B opens Royal Duels, T switches the theme, E exports the screen you are on.',
      'Royal Duels, Deck’s Home and Counter Palette now have Undo and Redo, with Ctrl Z and Ctrl Shift Z. Each tool keeps its own history, so a card you removed, a cleared deck, a Reset or a deleted folder can all be brought back.',
    ],
    href: '#/builder',
    hrefLabel: 'Open Royal Duels',
  },
  {
    id: '2026-09-28-recent-and-form',
    date: '2026-09-28',
    kind: 'new',
    title: 'Your recent players on the home screen, and a form strip on Recent Battles',
    body: [
      'The players you have looked up now wait under the search box, so you do not have to type your own tag again. The list lives in this browser only, and Clear empties it.',
      'Recent Battles opens with your last 20 results as a row of wins and losses, with your current streak named. Tap any of them to jump to that battle in the log. Locked areas now show a blurred look at what is inside.',
    ],
    href: '#/',
    hrefLabel: 'Go to the home screen',
  },
  {
    id: '2026-09-28-trends-and-tables',
    date: '2026-09-28',
    kind: 'fixed',
    title: 'The win rate charts no longer treat a day you did not play as a day you lost',
    body: [
      'A day a deck was not played used to be drawn as a 0% win rate, and the Trend column in your Top 10 averaged those days in — so a deck you simply played less often lately looked like it was collapsing. Those days are now gaps, the trend compares your games in the earlier and later half of the days you played the deck, and hovering a deck in the legend picks its line out of the others.',
      'The Top 10 and Top Meta Decks tables no longer hide columns off the edge of a laptop screen, and the password field on the sign-in page is the full width again.',
    ],
  },
  {
    id: '2026-09-27-coach-tuner-pro',
    date: '2026-09-27',
    kind: 'new',
    title: 'Pro: Coach Assist can now suggest card swaps, other decks and a full three-deck loadout',
    body: [
      'Below the Suggestion, Pro accounts now see three more answers: a card or two to switch in the deck you picked and how much that moves your worst matchup, other decks that beat what they bring, and a full loadout of three decks that share no cards.',
      'Every deck in them uses its evolution, hero and wild slots — a deck whose cards cannot fill all three is not suggested.',
    ],
  },
  {
    id: '2026-09-27-coach-duels',
    date: '2026-09-27',
    kind: 'improved',
    title: 'Coach Assist now reads real duels when it tells you what to play next',
    body: [
      'Every expected win rate in the Suggestion window is now worked out the way Team Analysis does it: against the exact decks your opponent is likely to bring, from ladder games and real duels together. Tested against 11,102 later duel games, it predicts results better than the old rate did.',
      'One of your three options can now be a deck proven in real duels against what they bring — marked Duel pick. It is always legal: a deck that repeats a card you have already played is never offered.',
    ],
  },
  {
    id: '2026-09-27-deck-vs-deck-home',
    date: '2026-09-27',
    kind: 'new',
    title: 'Compare any two decks head to head on Deck Counter, without searching a player',
    body: [
      'Deck Counter now has a Deck vs Deck tab next to Find counters: paste two deck links and see how they do against each other, the record behind it and the cards that differ. It used to be available only after searching a player.',
      'On both Deck Counters the two pasted decks now fit side by side on a desktop, and on a phone the result shows each deck in two rows of four instead of shrinking the cards to dots.',
    ],
  },
  {
    id: '2026-09-27-version-matchups',
    date: '2026-09-27',
    kind: 'improved',
    title: 'Team Analysis rates every matchup against the exact list your opponent plays',
    body: [
      'Two Log Bait lists are not the same matchup, and now they are not rated as one. Every expected win rate on Team Analysis is worked out against each specific list the opponent is likely to bring — from how your deck and its one-card variants have done against that list and its variants — instead of against the deck type as a whole.',
      'It also reads the ladder and real duels together as one number, instead of two brains side by side. How much each kind of game counts was measured against thousands of later duels, not chosen. Suggestions still mix your own decks with the strongest lists anyone plays, so where one list clearly beats an opponent, more of your squad may be pointed at it.',
    ],
    href: '#/teams',
    hrefLabel: 'Open Team Analysis',
  },
  {
    id: '2026-09-27-full-loadout',
    date: '2026-09-27',
    kind: 'fixed',
    title: 'Every suggested deck now fills its evolution, hero and champion slots',
    body: [
      'Decks Deckkies suggests — on Team Analysis, the coach’s plan against the field and Coach Assist — are now drawn with every special slot their cards can fill. Before, a deck was shown the way someone had last played it, so an evolution nobody had used stayed a plain card even though the deck could field it.',
      'Deckkies also stopped suggesting its own picks from lists that cannot fill all three slots, and takes the next list of that deck type instead. Your own decks are never dropped, and an opponent’s decks are still shown exactly as they were played. A form Deckkies filled in says so when you hover the card.',
    ],
    href: '#/teams',
    hrefLabel: 'Open Team Analysis',
  },
  {
    id: '2026-09-27-duel-brain',
    date: '2026-09-27',
    kind: 'new',
    title: 'Team Analysis now searches real duels for decks that win',
    body: [
      'A second brain reads every stored duel game — over 330,000 of them — and finds the decks that have actually won in duels against the win conditions your opponent brings, including the ones they bring to their own duels. Up to two of each teammate’s seven options are held for decks proven that way: a teammate’s own duel decks first, then the ones duel players win with, leaning on cards that teammate already plays, and shared out so the squad does not all get the same deck.',
      'Rows it chose say Duel pick, and every deck with enough duel games shows its duel win rate beside the usual figures. That rate takes out how strong the players were and is set so it matches what those decks went on to win in later duels, not their best stretch.',
    ],
    href: '#/teams',
    hrefLabel: 'Open Team Analysis',
  },
  {
    id: '2026-09-27-team-pdf-per-player',
    date: '2026-09-27',
    kind: 'new',
    title: 'Team Analysis can export one player’s plan on its own',
    body: [
      'Beside Export PDF there is now a choice of who the document covers: the whole match plan, or any single player on either side. A teammate’s PDF holds their own decks and, for every opponent, what that opponent plays and that teammate’s ranked options against them. An opponent’s PDF is that opponent’s whole section, with every teammate’s answers.',
      'Each player can be handed just the pages that are theirs, and they are the same pages the full plan prints.',
    ],
    href: '#/teams',
    hrefLabel: 'Open Team Analysis',
  },
  {
    id: '2026-09-26-pdf-reports',
    date: '2026-09-26',
    kind: 'improved',
    title: 'PDF reports are rebuilt: fast to open, and every tab is in them',
    body: [
      'Export PDF now draws a proper Deckkies report instead of printing the page. Files are a fraction of the size and open and scroll about ten times faster. Every card sits in its slot with its evolution or hero art, and every deck carries an Open in game button that works from the PDF.',
      'On a player’s page the one Export button covers every tab of the screen you are on, or the full player report: every section you can open, in one document with a contents page. Team Analysis, 2v2 Decks, Recent Battles, Deck Counter and Coach Assist export too.',
    ],
  },
  {
    id: '2026-09-21-team-analysis-12',
    date: '2026-09-21',
    kind: 'improved',
    title: 'Team Analysis takes twelve a side, and answers in seconds',
    body: [
      'Paste up to twelve players on each side. A full match plan used to take two or three minutes to work out; it now takes a few seconds.',
      'Saved analyses follow your account, so a board you save on your computer opens on your phone.',
    ],
    href: '#/teams',
    hrefLabel: 'Open Team Analysis',
    needs: 'trial',
  },
  {
    id: '2026-09-20-dropdowns',
    date: '2026-09-20',
    kind: 'improved',
    title: 'Every dropdown on the site works the same way now',
    body: [
      'Sort, per-page, rarity, elixir, game mode, season and the rest all open the same panel: in the site’s own light or dark theme instead of your system’s, with a short explanation under the choices that need one — what each sort order actually ranks by, which months a season covers — and a tick on the one that is picked.',
      'They work from the keyboard too — arrow keys to move, a letter to jump, Enter to pick, Escape to close — and the country list when you set up an account has a search box, so you can type to find yours.',
    ],
    href: '#/duo',
    hrefLabel: 'Try one on 2v2 Decks',
  },
  {
    id: '2026-09-19-contrast-duo',
    date: '2026-09-19',
    kind: 'improved',
    title: 'Every label is full black or full white now',
    body: [
      'A few labels were still drawn faded — the date chips that reach past a player’s stored history, the 2nd and 3rd place ranks on a player’s deck board, and the Search label in the top bar. They are all full black on the light theme and full white on the dark one. A date chip beyond the stored history is marked with a dashed edge instead of being greyed out.',
      '2v2 Decks is tighter: smaller cards, so more partnerships fit on a screen, with the summary figures and the footnote removed. The page buttons under long lists are smaller too.',
    ],
    href: '#/duo',
    hrefLabel: 'Open 2v2 Decks',
  },
  {
    id: '2026-09-19-footer',
    date: '2026-09-19',
    kind: 'new',
    title: 'The home page has a proper footer now',
    body: [
      'At the bottom of the home page: every deck tool and analytics screen in one place, a link to the field book and to this feed, and the two ways to reach me — on X or by email.',
      'It also says plainly that Deckkies is an unofficial fan project, not affiliated with Supercell, and where the card data comes from.',
    ],
    href: '#/',
    hrefLabel: 'Go home',
  },
  {
    id: '2026-09-19-pagination',
    date: '2026-09-19',
    kind: 'improved',
    title: 'Jump straight to any page of a long list',
    body: [
      'The battle log and 2v2 Decks share one new page picker. 2v2 Decks used to have only Previous and Next, so reaching a page further down meant clicking through every page before it; now the first page, the last page and the pages around the one you are on are always a click away.',
      'Turning a page from the bottom of a list takes you back to the top of the new page, and the list stays on screen while the next page loads instead of disappearing behind a loading screen.',
    ],
    href: '#/duo',
    hrefLabel: 'Open 2v2 Decks',
  },
  {
    id: '2026-09-12-phone-nav',
    date: '2026-09-12',
    kind: 'fixed',
    title: 'The navigation bar is back on phones',
    body: [
      'On a phone the top navigation was hidden, and the strip that replaced it listed a player’s analytics sections rather than the places you can go. So standing in a deck tool there was no way to reach another one: Royal Duels, Deck’s Home and Counter Palette could only be opened from the home screen or from inside the account menu.',
      'The navigation bar now sits on its own row under the wordmark, on every screen and at every width, carrying the same eight destinations it does on a desktop. The section strip stays where it belongs, on the screens that have sections.',
      'The bar also fits properly now. The wordmark was being painted under the buttons beside it at every phone size; those controls had 43 more pixels of content than room at 390px wide.',
    ],
    href: '#/',
    hrefLabel: 'Go home',
  },
  {
    id: '2026-09-11-duo-decks',
    date: '2026-09-11',
    kind: 'new',
    title: 'See which decks people bring together in 2v2',
    body: [
      '2v2 Decks is a new screen. It ranks the teammate deck combinations people actually play — the two decks a pair brought into the same battle, not one deck against another — with how many battles each partnership has and how many players ran it.',
      'Both halves of a pair get their own Copy link and Open in Game, so you can take either deck straight into the game. Sort by most played, most recent or first seen, and search by card to find every partnership running it.',
      'It reads from the raw battle record rather than from the battle list, because a battle row stores your deck and your opponent\u2019s — a teammate\u2019s deck is in no column of it.',
    ],
    href: '#/duo',
    hrefLabel: 'Open 2v2 Decks',
    needs: 'trial',
  },
  {
    id: '2026-09-04-guide-zoom',
    date: '2026-09-04',
    kind: 'fixed',
    title: 'The field book zooms on a phone',
    body: [
      'Pinch to zoom works on the field book now. It had been switched off without anyone meaning to: the page deliberately locks sideways swiping so that dragging across the book turns the page, and the setting that does that was also disabling the browser\'s own pinch. So the one screen made of small print was the one screen a phone could not magnify — and the magnifying glass is a desktop thing, so there was nothing else to reach for.',
      'The minus / plus controls under the book work there too. They had been counting up and down from 90% to 150% without moving anything.',
      'While you are zoomed in, the two arrows either side of the book are off the edge of the screen — that is just what zooming does. Tap either half of the page itself to turn it instead; the book says so now, which on a phone it never did.',
    ],
    href: '#/guide',
    hrefLabel: 'Open the field book',
  },
  {
    id: '2026-09-02-scouting-report',
    date: '2026-09-02',
    kind: 'new',
    title: 'Scout one roster without pasting your own',
    body: [
      'Team Analysis now has two tabs. Scouting Report takes a single roster — theirs — and tells you what they actually play and which decks beat it, so you can size up an opponent without having your own squad to hand.',
      'Match Plan is the screen you already know, unchanged: paste both rosters and get a folder per opponent with the decks your own players should answer them with. Your paste carries across when you switch tabs, so scouting a clan and then planning the match against it is one paste rather than two.',
    ],
    href: '#/teams',
    hrefLabel: 'Open Team Analysis',
    needs: 'trial',
  },
  {
    id: '2026-09-01-passwords',
    date: '2026-09-01',
    kind: 'fixed',
    title: 'You can change your password, and a reset link works',
    body: [
      'There is a Change password option in your account menu, and it asks for your current password first so an unattended browser is not enough to take an account over.',
      'Forgot your password now genuinely resets it. It did not before — the emailed link signed you in and left the old password in force, with nothing anywhere able to change it. If you tried that and it seemed to do nothing, this is why.',
    ],
  },
  {
    id: '2026-09-01-coach-continues',
    date: '2026-09-01',
    kind: 'improved',
    title: 'Coach Assist carries on to the next game',
    body: [
      'When the Suggestion window gives you an answer, it now offers to move on to the next game of the duel. Before, the only way forward was Start over, which threw away both tags and every deck you had pasted — at the exact moment a duel was running.',
    ],
    href: '#/',
    hrefLabel: 'Search a player',
    needs: 'pro',
  },
  {
    id: '2026-08-30-team-saves',
    date: '2026-08-30',
    kind: 'new',
    title: 'Save a team analysis and come back to it',
    body: [
      'Finished boards can be saved and reopened later. A restored board says how old its figures are, because nothing in it is recalculated on opening — and it keeps the rosters you pasted, so Re-run measures the same squads against today rather than asking you to type them again.',
    ],
    href: '#/teams',
    hrefLabel: 'Open Team Analysis',
    needs: 'trial',
  },
  {
    id: '2026-08-30-team-pdf',
    date: '2026-08-30',
    kind: 'new',
    title: 'Print a team analysis as a match dossier',
    body: [
      'Export PDF on Team Analysis produces a document rather than a screenshot of the screen: a section for every player on both sides, a heat map of the whole board, head-to-head spreads, and a method section explaining where each number came from. It prints in whichever theme you are reading in.',
    ],
    needs: 'trial',
  },
  {
    id: '2026-08-30-team-open',
    date: '2026-08-30',
    kind: 'improved',
    title: 'Team Analysis is included in the free trial',
    body: [
      'It used to be hidden. Everyone can see it now, and the three-day trial opens it along with Pro — it is the feature most worth trying on a real roster before deciding whether to pay for anything.',
      'Rosters can also be ten players a side, up from eight, because a ranked list off a Discord channel is numbered one to ten. Pasting one with the links still in it works: tags are read out of them.',
    ],
    href: '#/teams',
    hrefLabel: 'Open Team Analysis',
    needs: 'trial',
  },
  {
    id: '2026-08-26-analytics-hosted',
    date: '2026-08-26',
    kind: 'improved',
    title: 'The analytics screens work everywhere now',
    body: [
      'The service behind the meta board, the counters and the duel screens moved onto a server of its own. For most of this site’s life those screens only had data when one particular machine was switched on; they no longer depend on it.',
    ],
  },
];

/** The newest entry's id, or null when the feed is empty. */
export function newestReleaseId(releases: Release[] = RELEASES): string | null {
  return releases.length ? releases[0].id : null;
}

/**
 * How many entries are newer than the one last marked as read.
 *
 * POSITION, NOT DATES. The array is the chronology (see above), so the count
 * is simply how far down the list the seen mark sits.
 *
 * `null` — nobody has read anything on this browser — is **0, not everything**,
 * and that is the load-bearing case. A first-time visitor has no history with
 * this product, and greeting them with a badge saying seven things are new is
 * an announcement about a thing they have never seen. The caller stamps the
 * newest id on first sight instead; see `markSeen` in the store.
 *
 * AN UNRECOGNISED ID IS ALSO 0. A changelog is append-only, so that only
 * happens if history was edited — and in that case the honest count is not
 * knowable. Missing one badge is a smaller failure than showing every reader
 * the whole feed again.
 */
export function unreadCount(seenId: string | null, releases: Release[] = RELEASES): number {
  if (!seenId) return 0;
  const i = releases.findIndex((r) => r.id === seenId);
  return i < 0 ? 0 : i;
}
