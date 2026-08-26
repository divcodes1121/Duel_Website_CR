/**
 * Countries for the onboarding step.
 *
 * ISO 3166-1 alpha-2 CODES ONLY, with the names resolved at runtime by
 * `Intl.DisplayNames`. Shipping 250 English names would be ~4 kB of data the
 * browser already has, and it would only ever be in English — this way a
 * visitor whose browser is set to French gets "Allemagne" for free, and what we
 * store is the code, which is what a stable record wants anyway.
 *
 * The fallback matters: `Intl.DisplayNames` is everywhere current but a
 * hardened or very old browser can lack it, and a country picker showing bare
 * two-letter codes is still usable where an empty one is not.
 */

const CODES =
  'AD AE AF AG AI AL AM AO AR AT AU AW AZ BA BB BD BE BF BG BH BI BJ BM BN BO BR BS BT BW BY BZ ' +
  'CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR ' +
  'GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH ' +
  'KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR ' +
  'MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PR PS PT PW PY QA RO RS ' +
  'RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV ' +
  'TW TZ UA UG US UY UZ VA VC VE VN VU WS YE ZA ZM ZW';

export interface Country {
  code: string;
  name: string;
}

export function countries(): Country[] {
  let name: (c: string) => string;
  try {
    const dn = new Intl.DisplayNames(undefined, { type: 'region' });
    name = (c) => dn.of(c) ?? c;
  } catch {
    name = (c) => c;
  }
  return CODES.split(' ')
    .filter(Boolean)
    .map((code) => ({ code, name: name(code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A first guess at where someone is, from their browser's locale.
 *
 * A GUESS, and pre-selected rather than assumed — the field stays editable and
 * the value is only a default. Geolocating by IP would be more accurate and
 * would also mean sending an address to a third party to learn something the
 * person is about to type anyway.
 */
export function guessCountry(): string {
  try {
    const loc = new Intl.Locale(navigator.language);
    const region = loc.maximize().region;
    return region && CODES.includes(region) ? region : '';
  } catch {
    return '';
  }
}
