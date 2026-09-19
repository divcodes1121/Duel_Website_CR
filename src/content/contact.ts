/**
 * The two real ways to reach the person who runs this site.
 *
 * ONE COPY. These lived as constants inside `ProContact.tsx`, and the footer
 * needs the same two — a second copy of an email address is exactly the kind
 * of thing that is updated in one place and left stale in the other, and a
 * stale contact link fails silently: it still looks like a link.
 *
 * There is no Instagram, LinkedIn or Discord here because there is none. A
 * footer template that ships with five social icons is not a reason to invent
 * accounts.
 */
export const TWITTER_URL = 'https://x.com/CaptainFrozeCR';
export const TWITTER_HANDLE = '@CaptainFrozeCR';
export const EMAIL = 'singh.divyanshu1121@gmail.com';
