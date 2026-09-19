import { useState } from 'react';

import { Footer5, type Footer5LinkGroup } from '../ui/footer-5';
import { MailIcon, XIcon } from '../Analytics/ProContact';
import { WhatsNewDialog } from '../WhatsNew/WhatsNew';
import { EMAIL, TWITTER_URL } from '../../content/contact';
import {
  BarsIcon,
  BellIcon,
  CardsIcon,
  DeckIcon,
  DuoIcon,
  InfoIcon,
  PaletteIcon,
  SearchIcon,
  SwordsIcon,
  TeamIcon,
} from './icons';
import styles from './SiteFooter.module.css';

/**
 * The foot of the landing screen: the vendored `Footer5`, filled with this
 * site rather than the template's.
 *
 * EVERYTHING IN IT IS REAL, which is the whole brief for a footer here. The
 * template ships Instagram and LinkedIn buttons, a sales team that "typically
 * responds within 2 hours" and Terms / Privacy / Cookie links. None of those
 * exist for this site, and a footer is exactly where readers go to check what
 * a site is — so each was replaced by the thing that does exist or dropped:
 *
 *   - Connect: X and email, the two channels `ProContact` has always offered,
 *     read from `content/contact.ts` so there is one copy of each.
 *   - The contact card opens that same "Write to me" dialog, and says what it
 *     says: Pro is arranged by hand. No response time is promised.
 *   - The columns are the site's own destinations, each with the glyph and
 *     identity hue it wears in the dock, the rail and the landing panels —
 *     named what those surfaces call them.
 *   - The bottom row credits what the site is built on instead of listing legal
 *     pages it does not have.
 *
 * THE FAN-CONTENT LINE IS BACK ON THE LANDING PAGE, here. It was taken out of
 * the closing band on request (2026-09-01); Supercell's Fan Content Policy asks
 * for it, and a footer's legal row is where readers expect it. It is one line
 * in `copyright` below to remove again if that is still the call.
 */

const LOGO_URL = `${import.meta.env.BASE_URL}assets/brand/logo-dark.png`;

export function SiteFooter({
  onSearch,
  onMeta,
  onContact,
}: {
  /** Back to the top of the landing screen, where the tag search is. */
  onSearch: () => void;
  /** Open the Top Meta Decks section — a section of home, not a route. */
  onMeta: () => void;
  /** The "Write to me" dialog. */
  onContact: () => void;
}) {
  const [feed, setFeed] = useState(false);

  const linkGroups: Footer5LinkGroup[] = [
    {
      title: 'Deck tools',
      links: [
        { label: 'Royal Duels', href: '#/builder', icon: <SwordsIcon size={15} />, hue: 'violet' },
        { label: "Deck's Home", href: '#/decks', icon: <DeckIcon size={15} />, hue: 'green' },
        { label: 'Counter Palette', href: '#/palette', icon: <PaletteIcon size={15} />, hue: 'blue' },
      ],
    },
    {
      title: 'Analytics',
      links: [
        { label: 'Search a player', href: '#/', onClick: onSearch, icon: <SearchIcon size={15} />, hue: 'violet' },
        { label: 'Top Meta Decks', href: '#/', onClick: onMeta, icon: <BarsIcon size={15} />, hue: 'blue' },
        { label: 'Team Analysis', href: '#/teams', icon: <TeamIcon size={15} />, hue: 'pink' },
        { label: '2v2 Decks', href: '#/duo', icon: <DuoIcon size={15} />, hue: 'green' },
      ],
    },
    {
      title: 'Learn',
      links: [
        { label: 'The field book', href: '#/guide', icon: <InfoIcon size={15} /> },
        { label: "What's new", onClick: () => setFeed(true), icon: <BellIcon size={15} /> },
        {
          label: 'Every analytics area',
          onClick: () =>
            document
              .getElementById('analytics-areas')
              ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
          icon: <CardsIcon size={15} />,
        },
      ],
    },
  ];

  return (
    <>
      <Footer5
        className={styles.footer}
        /* The same dark tile the top bar and the favicon use, so the mark is
           one object wherever it appears. */
        logo={
          <span className={styles.mark}>
            <img src={LOGO_URL} alt="" draggable={false} />
          </span>
        }
        brandName="DECKKIES"
        topNavLabel="Connect"
        socialLinks={[
          { icon: <XIcon size={16} />, href: TWITTER_URL, label: 'X / Twitter' },
          { icon: <MailIcon size={16} />, href: `mailto:${EMAIL}`, label: 'Email' },
        ]}
        contactHeading="Get in touch"
        contactCta={{
          icon: <MailIcon size={20} />,
          title: 'Write to me',
          description:
            'Questions, a bug, or Pro for your account — there is no checkout yet, so Pro is set up by hand.',
          onClick: onContact,
        }}
        linkGroups={linkGroups}
        brandWatermark="DECKKIES"
        /* The logo drawn as a MASK, so the raster mark takes the watermark's
           faint ink like the letters beside it. As an <img> it would print in
           full colour in the middle of a ghosted word. */
        watermarkMark={
          <span className={styles.ghost} style={{ WebkitMaskImage: `url(${LOGO_URL})`, maskImage: `url(${LOGO_URL})` }} />
        }
        copyright={
          <>
            © {new Date().getFullYear()} DECKKIES · Unofficial fan content, not affiliated with or
            endorsed by Supercell.
          </>
        }
        legalLinks={[
          { label: 'Fan Content Policy', href: 'https://supercell.com/en/fan-content-policy/' },
          { label: 'Card data: RoyaleAPI', href: 'https://github.com/RoyaleAPI/cr-api-data' },
        ]}
      />
      {feed && <WhatsNewDialog onClose={() => setFeed(false)} />}
    </>
  );
}
