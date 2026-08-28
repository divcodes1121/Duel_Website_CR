/* The nav icons, as SINGLE FILLED PATHS, so every dock item can morph.
 *
 * WHY THESE EXIST AT ALL. `icons.tsx` draws the shell's icons as 24x24 STROKED
 * line art, and most are several elements: the house is two `<path>`s, the
 * swords are four, the card and the chart are a `<rect>` plus a path.
 * MorphSVGPlugin interpolates ONE path into ONE path. That is the whole reason
 * only Home appeared to work — the registry component matches on
 * `title.toLowerCase()` against its own seven names, "Home" was the only hit,
 * and it morphed the component's OWN built-in house rather than ours. Every
 * other item fell through to the plain `<Icon>` branch and simply never
 * animated.
 *
 * So each nav destination gets a one-path filled twin here. They are shapes the
 * stroked originals already describe — a house, a chart in a card, a card with
 * a face, crossed swords, a folder, three bars — redrawn as a single closed
 * outline, which is the form the effect needs and the form the source's own
 * icons take.
 *
 * THE DOCK IS THE ONLY CONSUMER. `icons.tsx` is untouched and the sidebar, the
 * rail and every panel keep the line icons they have always had; a filled icon
 * set is heavier and this is not a change to the app's iconography.
 */

/** 24x24, filled, one subpath-set per icon. */
export const DOCK_PATHS: Record<string, string> = {
  /* The source's own house, kept so Home looks exactly as it did when it was
     the one item the component recognised. */
  Home:
    'M21 18V10.5339C21 9.57062 20.5374 8.66591 19.7565 8.1019L13.7565 3.76856C12.7079 '
    + '3.01128 11.2921 3.01128 10.2435 3.76856L4.24353 8.1019C3.46259 8.66591 3 9.57062 '
    + '3 10.5339V18C3 19.6569 4.34315 21 6 21H18C19.6569 21 21 19.6569 21 18Z',

  /* a chart inside a card — the stroked original is a rect plus three bars */
  Analytics:
    'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 '
    + '17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z',

  /* a card with a face on it — rect plus inner rect, closed as one path */
  'Deck Vault':
    'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-3 '
    + '12H8V9h8v6z',

  /* crossed swords, drawn as four blades in one path so it can still morph */
  'Duel Builder':
    'M6.5 3H3v3.5l8 8L14.5 11l-8-8zM17.5 3 13 7.5 15.5 10 21 4.5V3h-3.5zM8.5 14 3 '
    + '19.5V21h1.5L10 15.5 8.5 14zm7 0L13 16.5 17.5 21H21v-3.5L16.5 13l-1 1z',

  /* the folder the stroked Counter Hub icon already is */
  'Counter Hub':
    'M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',

  /* three bars */
  Meta: 'M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z',
};

/** The two droplet shapes the source squashes an icon through on its way back.
 *
 *  Taken verbatim from `nexus`-style `animateBlog` / `animateMarker` /
 *  `animateEmail` / `animateX` / `animateGithub`, all five of which share this
 *  pair. Home is the odd one out in the source and uses a different, narrower
 *  pair; the shared one is used here so all six items squash identically, which
 *  is the point of the change. */
export const DROPLET_A =
  'M12 21C12 21 15.3954 18.8605 13.3637 16C12.0647 14.1711 9.51275 11.9823 9 10C8 '
  + '6.134 10.134 3 12 3C13.866 3 16 6.134 15 10C14.4873 11.9823 11.9353 14.1711 '
  + '10.6363 16C8.60464 18.8605 12 21 12 21Z';

export const DROPLET_B =
  'M12 21C12 21 14.0216 19.0215 14.3637 16C14.6026 13.8898 13.5128 11.9823 13 10C12 '
  + '6.134 13.134 3 12 3C10.866 3 12 6.134 11 10C10.4873 11.9823 9.39736 13.8898 '
  + '9.6363 16C9.97843 19.0215 12 21 12 21Z';
