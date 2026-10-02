/** Two letters for an avatar: the first of each of the first two words, or
 *  the first two of a single word. A tag loses its `#`. "Coach Mira" is CM,
 *  not CO — the first two letters of a shared prefix say nothing.
 *
 *  A WORD IS SOMETHING WITH A LETTER OR A DIGIT IN IT, and its initial is the
 *  first of those. Player names are decorated: "傳奇 | Sir✨Jose✨" split on
 *  spaces has a bare "|" as its second word, and its avatar read "傳|". A
 *  separator or an emoji is not an initial. A name made of nothing else keeps
 *  the old behaviour, so the disc is never empty.
 *
 *  NO IMPORTS, on purpose. It lived in `ui/dash-shell.tsx`, which is part of
 *  the lazy dashboard chunk; the battle log is in the main bundle and wants
 *  the same two letters without pulling a sidebar in to get them. */
const WORDY = /[\p{L}\p{N}]/u;

export function initialsOf(label: string): string {
  const clean = label.replace(/^#/, '').trim();
  const words = clean.split(/\s+/).filter((w) => WORDY.test(w));
  if (words.length === 0) return [...clean].slice(0, 2).join('').toUpperCase();
  const letters = (w: string) => [...w].filter((ch) => WORDY.test(ch));
  const chars =
    words.length > 1 ? [words[0], words[1]].map((w) => letters(w)[0]) : letters(words[0]).slice(0, 2);
  return chars.join('').toUpperCase();
}
