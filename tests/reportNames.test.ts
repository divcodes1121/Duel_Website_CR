import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { reportFilename, type ReportDoc } from '../src/utils/analyticsReport';
import { asciiFold, romanize } from '../src/utils/report/romanize';
import {
  drawable,
  faceFor,
  facesNeeded,
  fullName,
  latinName,
  printableName,
} from '../src/utils/report/text';
import { teamAnalysisReport } from '../src/utils/teamReport';
import type { TeamReport } from '../src/state/analyticsClient';

/**
 * A NAME IN ANOTHER SCRIPT PRINTS AS WRITTEN, AND IN LATIN LETTERS BESIDE IT.
 *
 * Reported against a scouting report of seven players: the four whose names
 * were kana printed as their tags, because the report's fonts were Latin only
 * and a name they could not draw fell back to the tag. The names below are
 * the ones from that roster.
 */

describe('romanising a name', () => {
  it('reads kana as Hepburn', () => {
    expect(romanize('まぁ')).toBe('Maa');
    expect(romanize('こっとん')).toBe('Kotton');
    expect(romanize('ふりてゃん')).toBe('Furityan');
    expect(romanize('マイクジョーンズ')).toBe('Maikujōnzu');
    expect(romanize('ゴリラ✨')).toBe('Gorira');
  });

  it('handles the small kana and the doubled consonant', () => {
    expect(romanize('きょう')).toBe('Kyou');
    expect(romanize('しゃちょう')).toBe('Shachou');
    expect(romanize('まっちゃ')).toBe('Matcha');
    expect(romanize('ファイア')).toBe('Faia');
    expect(romanize('ウィザード')).toBe('Wizādo');
    expect(romanize('ティー')).toBe('Tī');
  });

  it('reads Cyrillic, keeping the capitals', () => {
    expect(romanize('Потужнi лававод')).toBe('Potuzhni lavavod');
    expect(romanize('Щука')).toBe('Shchuka');
  });

  it('keeps the Latin a name already has', () => {
    expect(romanize('MuK｜⚡Lucaさん⚡')).toBe('MuK|Lucasan');
  });

  it('adds nothing to a name that is already Latin', () => {
    expect(romanize('Kitsune')).toBeNull();
    expect(romanize('꧁✭hiro✭꧂')).toBeNull();
    expect(romanize('')).toBeNull();
  });

  it('does not spell out a katakana smile', () => {
    expect(romanize('Danzai ツ')).toBeNull();
  });

  it('refuses a script it has no rule for, rather than guess a reading', () => {
    expect(romanize('傳奇 | SirJose')).toBeNull();
    expect(romanize('山田たろう')).toBeNull();
    expect(romanize('한국 선수')).toBeNull();
  });

  it('folds macrons for a filename', () => {
    expect(asciiFold('Maikujōnzu')).toBe('Maikujonzu');
  });
});

describe('a name the report prints', () => {
  it('prints kana, kanji and Cyrillic as written', () => {
    expect(printableName('まぁ', '#ABC001')).toBe('まぁ');
    expect(printableName('マイクジョーンズ', '#ABC005')).toBe('マイクジョーンズ');
    expect(printableName('山田たろう', '#TAG')).toBe('山田たろう');
    expect(printableName('Потужнi лававод', '#J00VYRCR2')).toBe('Потужнi лававод');
  });

  it('drops only the decoration around a Latin name', () => {
    expect(printableName('꧁✭hiro✭꧂', '#ABC007')).toBe('hiro');
  });

  it('gives both forms where a list introduces a player', () => {
    expect(fullName('こっとん', '#ABC002')).toBe('こっとん (Kotton)');
    expect(fullName('Kitsune', '#ABC004')).toBe('Kitsune');
    expect(fullName('山田', '#TAG')).toBe('山田');
    // Unprintable: the tag stands in, and nothing is romanised beside a tag.
    expect(fullName('한국 선수', '#TAG')).toBe('#TAG');
    expect(latinName('한국 선수')).toBeNull();
  });
});

describe('the faces a document needs', () => {
  it('asks for the kana file only when there is kana, the kanji file only for kanji', () => {
    expect([...facesNeeded('Kitsune — opponent')]).toEqual([]);
    expect([...facesNeeded('Потужнi')]).toEqual([]);
    expect([...facesNeeded('まぁ')]).toEqual(['kana']);
    expect([...facesNeeded('山田')]).toEqual(['kanji']);
    expect([...facesNeeded('山田たろう')].sort()).toEqual(['kana', 'kanji']);
  });

  it('draws each character in the first face that holds it', () => {
    expect(faceFor('a'.codePointAt(0)!, 'display')).toBe('display');
    expect(faceFor('Ж'.codePointAt(0)!, 'body')).toBe('body');
    // Bebas has no Cyrillic: a heading falls to Inter, not to nothing.
    expect(faceFor('Ж'.codePointAt(0)!, 'display')).toBe('bodyBold');
    expect(faceFor('た'.codePointAt(0)!, 'bodyBold')).toBe('kana');
    expect(faceFor('山'.codePointAt(0)!, 'body')).toBe('kanji');
    expect(faceFor('한'.codePointAt(0)!, 'body')).toBeNull();
  });

  it('filters a character whose face did not load', () => {
    expect(drawable('まぁ (Maa)', 'body', true, new Set())).toBe('(Maa)');
    expect(drawable('まぁ (Maa)', 'body', true, new Set(['kana']))).toBe('まぁ (Maa)');
    expect(faceFor('た'.codePointAt(0)!, 'body', new Set())).toBeNull();
  });

  it('ships a file for every face the glyph list names', () => {
    const dir = path.resolve(__dirname, '../public/assets/fonts/report');
    for (const f of ['Inter-Regular.ttf', 'Inter-SemiBold.ttf', 'BebasNeue.ttf',
      'NotoSansJP-Kana.ttf', 'NotoSansJP-Kanji.ttf', 'NotoSansJP-OFL.txt']) {
      expect(fs.existsSync(path.join(dir, f)), f).toBe(true);
    }
    const src = fs.readFileSync(path.resolve(__dirname, '../src/utils/report/fonts.ts'), 'utf8');
    expect(src).toContain('NotoSansJP-Kana.ttf');
    expect(src).toContain('NotoSansJP-Kanji.ttf');
  });
});

/* ------------------------------------------------- the scouting report */

const member = (name: string, tag: string) => ({
  tag,
  name,
  basis: 'stored',
  battles: 148,
  winRate: 60.1,
  decks: 6,
  window: { from: '2026-09-19', to: '2026-10-03' },
});

const folder = (name: string, tag: string) => ({
  player: member(name, tag),
  theirDecks: [],
  spread: [],
  recommended: [],
  perPlayer: [],
  considered: 204,
  reason: null,
});

const ROSTER: [string, string][] = [
  ['まぁ', '#ABC001'],
  ['こっとん', '#ABC002'],
  ['Kitsune', '#ABC004'],
  ['マイクジョーンズ', '#ABC005'],
];

const report = {
  mode: 'scout',
  days: 15,
  blue: [],
  red: ROSTER.map(([n, t]) => member(n, t)),
  folders: ROSTER.map(([n, t]) => folder(n, t)),
  pool: { decks: 204, reason: null },
  limits: { minComfortGames: 5 },
  rejected: { blue: [], red: [] },
  status: { ageSeconds: 1080, battles: 8986543 },
} as unknown as TeamReport;

describe('the scouting report names every player', () => {
  const doc: ReportDoc = teamAnalysisReport(report);
  const text = JSON.stringify(doc);

  it('prints the Japanese name, the Latin form and the tag', () => {
    const roster = doc.blocks.find((b) => b.kind === 'table' && b.heading === 'The roster');
    expect(roster && roster.kind === 'table').toBe(true);
    if (!roster || roster.kind !== 'table') return;
    const first = roster.rows[0];
    expect((first.name as { text: string }).text).toBe('まぁ (Maa)');
    expect(first.tag).toBe('#ABC001');
    expect((roster.rows[2].name as { text: string }).text).toBe('Kitsune');
  });

  it('opens each section on the name, with the Latin form beside the tag', () => {
    const openers = doc.blocks.filter((b) => b.kind === 'divider' && b.subtitle?.startsWith('Opponent'));
    expect(openers).toHaveLength(4);
    const [a, , c, d] = openers as { title: string; tag?: string; contents?: string }[];
    expect(a.title).toBe('まぁ');
    expect(a.tag).toBe('Maa  ·  #ABC001');
    expect(a.contents).toBe('まぁ (Maa) — opponent');
    expect(c.title).toBe('Kitsune');
    expect(c.tag).toBe('#ABC004');
    expect(d.tag).toBe('Maikujōnzu  ·  #ABC005');
  });

  it('never falls back to a tag for a name it can print', () => {
    expect(doc.subject).toBe('4 players — まぁ, こっとん, Kitsune +1');
    expect(text).not.toContain('#ABC001’s decks');
  });

  it('names the file in Latin letters', () => {
    expect(reportFilename(doc)).toMatch(/^deckkies-scouting-report-4-players-maa-kotton-kitsune-1-\d{4}-/);
  });
});
