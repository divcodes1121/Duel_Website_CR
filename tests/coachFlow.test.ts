import { describe, expect, it } from 'vitest';
import type { CoachAnswers, CoachAnswerDeck, CoachDeck } from '../src/state/analyticsClient';
import {
  answerInputs,
  answersKey,
  columnFor,
  decksFor,
  deckKeyOf,
  otherRates,
  theirSide,
  toFlowDeck,
  winConCard,
} from '../src/utils/coachFlow';
import { buildFlow, chainFor } from '../src/utils/matchupFlow';

const deck = (tag: string) => [tag, ...Array.from({ length: 7 }, (_, i) => `${tag}-f${i}`)];

function their(tag: string, extra: Partial<CoachDeck> = {}): CoachDeck {
  return { cards: deck(tag), art: {}, archetype: 'hog', deckName: `Deck ${tag}`, ...extra };
}

function row(tag: string, vsAt: CoachAnswerDeck['vsAt'], extra: Partial<CoachAnswerDeck> = {}): CoachAnswerDeck {
  const cards = deck(tag);
  return {
    key: deckKeyOf(cards), cards, art: {}, archetype: 'x', family: `fam-${tag[0]}`,
    familyName: `Family ${tag[0]}`, name: `List ${tag}`, avgElixir: 3.4, origin: 'crl',
    expectedWinRate: 60, weight: 1, vsAt, ...extra,
  };
}

const T = [their('t1', { prob: 0.6, count: 9 }), their('t2', { prob: 0.4 }), their('t3', { cards: ['x'] })];
const K1 = deckKeyOf(deck('t1'));
const K2 = deckKeyOf(deck('t2'));
const ANS: CoachAnswers = {
  brain: 'coach-answers-1.0',
  their: [{ key: K1, at: 0, likelihood: 0.6 }, { key: K2, at: 1, likelihood: 0.4 }],
  decks: [
    row('a1', [[70, 'deck', 40], [40, 'cluster7', 12]]),
    row('a2', [[50, 'deck', 40], [75, 'exact', 3]], { origin: 'yours', count: 4 }),
    row('b1', [[60, 'deck', 40], null]),
    row('o1', [[48, 'deck', 40], [45, 'deck', 40]], { origin: 'option', keep: true }),
  ],
  answers: [[0, 2], [1]],
  pool: { decks: 900, own: 1, rated: 901 },
  reason: null,
};

describe('Coach Assist matchup map', () => {
  it('sends their decks with eight cards, weighted by their share of the list', () => {
    expect(answerInputs(T)).toEqual([
      { cards: deck('t1'), weight: 0.6 },
      { cards: deck('t2'), weight: 0.4 },
    ]);
  });

  it('keys a request by what it asks, card order and all', () => {
    const a = answersKey(answerInputs(T), '#ME', [], [], 30);
    const shuffled = answerInputs([{ ...T[0], cards: [...T[0].cards].reverse() }, T[1]]);
    expect(answersKey(shuffled, '#ME', [], [], 30)).toBe(a);
    expect(answersKey(answerInputs(T), '#ME', [], [], 15)).not.toBe(a);
    expect(answersKey(answerInputs(T), '', [], [], 30)).not.toBe(a);
  });

  it('draws each deck of theirs as its own node, with the server chance', () => {
    const side = theirSide(T, ANS, ['Hog A', 'Hog B', 'x']);
    expect(side.keys).toEqual([K1, K2]);
    expect(side.plays.map((p) => [p.family, p.name, p.share, p.games])).toEqual([
      [K1, 'Hog A', 0.6, 9],
      [K2, 'Hog B', 0.4, 0],
    ]);
    expect(side.threats.every((t) => t.family === t.key)).toBe(true);
  });

  it('THE RIGHT-HAND COLUMN CHANGES WITH THE DECK OF THEIRS', () => {
    const keys = [K1, K2];
    expect(decksFor(ANS, keys, K1).map((d) => d.name)).toEqual(['List a1', 'List b1']);
    expect(decksFor(ANS, keys, K2).map((d) => d.name)).toEqual(['List a2']);
  });

  it('keeps the deck a map was opened on, wherever it is not already', () => {
    const keys = [K1, K2];
    const o1 = ANS.decks[3].key;
    // o1 rates 48 against K1: below a1 (70) and b1 (60), so last here...
    expect(decksFor(ANS, keys, K1, o1).map((d) => d.name)).toEqual(['List a1', 'List b1', 'List o1']);
    expect(decksFor(ANS, keys, K1, ANS.decks[0].key)).toHaveLength(2);
    // ...and against K2 (45 vs a2's 75) after a2; b1 (no rate vs K2) opened there goes last.
    expect(decksFor(ANS, keys, K2, o1).map((d) => d.name)).toEqual(['List a2', 'List o1']);
    expect(decksFor(ANS, keys, K2, ANS.decks[2].key).map((d) => d.name)).toEqual(['List a2', 'List b1']);
  });

  it('a deck opened on sits at its own place by its rate against that deck, not at the end', () => {
    const better = { ...ANS, decks: [...ANS.decks, row('z9', [[65, 'deck', 9], null])] };
    expect(decksFor(better, [K1, K2], K1, better.decks[4].key).map((d) => d.name))
      .toEqual(['List a1', 'List z9', 'List b1']);
  });

  it('keys every rate by their deck, and leaves a missing one out (never 50)', () => {
    const d = toFlowDeck(ANS.decks[2], [K1, K2]);
    expect(d.vs).toEqual({ [K1]: 60 });
    expect(d.vsLists).toEqual({ [K1]: [60, 'deck', 40] });
  });

  it('the chips under a deck are its rates against their OTHER decks', () => {
    const d = toFlowDeck(ANS.decks[0], [K1, K2]);
    expect(otherRates(d, [K1, K2], K1)).toEqual([{ key: K2, rate: 40 }]);
    expect(otherRates(d, [K1, K2], null)).toHaveLength(2);
  });

  it('opened on one of ours, the column is the deck of theirs it plays worst', () => {
    expect(columnFor(ANS, [K1, K2], ANS.decks[0].key)).toBe(K2);
    expect(columnFor(ANS, [K1, K2], ANS.decks[2].key)).toBe(K1);
    expect(columnFor(ANS, [K1, K2], 'nope')).toBe(K1);
  });

  it('feeds Team Analysis map arithmetic: one link per deck, its own rate', () => {
    const side = theirSide(T, ANS, ['Hog A', 'Hog B', 'x']);
    const model = buildFlow(side.plays, side.threats, decksFor(ANS, side.keys, K1));
    const chain = chainFor(model, { side: 'their', id: K1 });
    expect(chain.map((l) => l.rate)).toEqual([70, 60]);
    expect(chain[0].source).toBe('deck');
    expect(chain[0].games).toBe(40);
    const ours = chainFor(model, { side: 'ours', id: ANS.decks[0].key });
    expect(ours.map((l) => [l.family, l.rate])).toEqual([[K1, 70], [K2, 40]]);
  });

  it('the chip card is the priciest win condition, else the priciest card', () => {
    const info: Record<string, { elixir: number; isWinCondition: boolean }> = {
      'hog-rider': { elixir: 4, isWinCondition: true },
      'royal-giant': { elixir: 6, isWinCondition: true },
      pekka: { elixir: 7, isWinCondition: false },
      zap: { elixir: 2, isWinCondition: false },
    };
    const get = (k: string) => info[k];
    expect(winConCard(['zap', 'hog-rider', 'pekka', 'royal-giant'], get)).toBe('royal-giant');
    expect(winConCard(['zap', 'pekka'], get)).toBe('pekka');
    expect(winConCard(['unknown'], get)).toBeNull();
  });
});
