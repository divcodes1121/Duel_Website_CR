import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CARDS_BY_KEY } from '../src/data/cards';
import {
  cardFacts,
  closeCardInspect,
  formsOf,
  getCardInspect,
  openCardInspect,
  shouldInspect,
  startingForm,
} from '../src/state/cardInspect';
import { withViewTransition } from '../src/utils/viewTransition';

const card = (k: string) => CARDS_BY_KEY.get(k)!;
const read = (p: string) => readFileSync(p, 'utf8');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('one tab component', () => {
  it('is the only thing in src that draws a tablist', () => {
    const offenders = walk('src')
      .filter((p) => p.endsWith('.tsx'))
      .filter((p) => !p.replace(/\\/g, '/').endsWith('components/ui/tabs.tsx'))
      .filter((p) => /role=["{']*tablist/.test(read(p)));
    expect(offenders).toEqual([]);
  });

  it('keeps a 40px touch target and the selection hue', () => {
    const css = read('src/components/ui/tabs.module.css');
    expect(css).toMatch(/@media \(pointer: coarse\)[\s\S]*min-height: 40px/);
    expect(css).toMatch(/\.slab[\s\S]*?--solid-violet/);
  });

  it('the dashboards use it too', () => {
    expect(read('src/components/ui/bionis-dashboard.tsx')).toMatch(/<Tabs\b/);
    expect(read('src/components/ui/bionis-dashboard.css')).not.toMatch(/\.bd-tab(?!le)/);
  });
});

describe('card inspect rules', () => {
  afterEach(() => closeCardInspect());

  it('lists the forms a card has art for; a champion has no separate hero art', () => {
    expect(formsOf(card('knight'))).toEqual(['base', 'evolution', 'hero']);
    expect(formsOf(card('the-log'))).toEqual(['base']);
    const champ = [...CARDS_BY_KEY.values()].find((c) => c.isChampion)!;
    expect(formsOf(champ)).not.toContain('hero');
  });

  it('falls back to the base art for a form the card cannot take', () => {
    expect(startingForm(card('the-log'), 'evolution')).toBe('base');
    expect(startingForm(card('knight'), 'hero')).toBe('hero');
    expect(startingForm(card('knight'), undefined)).toBe('base');
  });

  it('states the catalogue facts', () => {
    const f = cardFacts(card('hog-rider'));
    expect(f[0]).toBe('4 elixir');
    expect(f).toContain('Win condition');
  });

  it('never opens from art inside a control', () => {
    expect(shouldInspect('knight', null)).toBe(true);
    expect(shouldInspect('knight', {})).toBe(false);
    expect(shouldInspect('', null)).toBe(false);
  });

  it('holds one request at a time', () => {
    openCardInspect({ key: 'knight' });
    openCardInspect({ key: 'hog-rider', form: 'base' });
    expect(getCardInspect()?.key).toBe('hog-rider');
    closeCardInspect();
    expect(getCardInspect()).toBeNull();
  });

  it('is wired to every card, and Duel Analysis rows opt out', () => {
    expect(read('src/components/Analytics/CardArt.tsx')).toMatch(/data-card=\{card\}/);
    expect(read('src/components/Analytics/DuelAnalysis.tsx')).toMatch(/data-no-inspect/);
    expect(read('src/App.tsx')).toMatch(/<CardInspectHost \/>/);
  });
});

describe('view transitions', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('updates at once where the browser has no API', () => {
    const update = vi.fn();
    withViewTransition(update, { visibilityState: 'visible' } as unknown as Document);
    expect(update).toHaveBeenCalledOnce();
  });

  it('hands the update to the browser where it has one', async () => {
    const update = vi.fn();
    let done!: () => void;
    const finished = new Promise<void>((r) => (done = r));
    const start = vi.fn((cb: () => void) => {
      cb();
      return { finished };
    });
    const doc = { visibilityState: 'visible', startViewTransition: start } as unknown as Document;
    withViewTransition(update, doc);
    expect(start).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    // A second route change during the fade goes straight through.
    const second = vi.fn();
    withViewTransition(second, doc);
    expect(start).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    done();
    await finished;
    await Promise.resolve();
  });

  it('never animates for a reader who asked for less motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }));
    const start = vi.fn();
    const update = vi.fn();
    withViewTransition(update, { visibilityState: 'visible', startViewTransition: start } as unknown as Document);
    expect(start).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledOnce();
  });

  it('the top bar holds still and the fade is short', () => {
    expect(read('src/components/Dashboard/Dashboard.module.css')).toMatch(/view-transition-name: topbar/);
    expect(read('src/index.css')).toMatch(/::view-transition-old\(root\)[\s\S]*animation-duration: 180ms/);
  });
});

describe('the landing art moves only where it may', () => {
  const css = () => read('src/components/Dashboard/Dashboard.module.css');

  it('the banner push-in is scroll-driven, feature-checked and off under reduced motion', () => {
    expect(css()).toMatch(
      /@supports \(animation-timeline: view\(\)\)\s*\{\s*@media \(prefers-reduced-motion: no-preference\)[\s\S]*?view-timeline: --banner block[\s\S]*?animation-timeline: --banner/,
    );
  });

  it('every banner scales about its own framing line', () => {
    const c = css();
    for (const name of ['team-analysis', 'royal-duels', 'counter-palette', 'decks-home']) {
      const pos = c.match(new RegExp(`data-banner='${name}'\\] \\.toolBanner \\{\\s*object-position: right (\\d+)%`));
      const origin = c.match(new RegExp(`data-banner='${name}'\\] \\.toolBanner \\{\\s*transform-origin: 50% (\\d+)%`));
      expect(pos?.[1], name).toBeDefined();
      expect(origin?.[1], name).toBe(pos?.[1]);
    }
  });

  it('the hero depth is mouse-only and off under reduced motion', () => {
    const hook = read('src/hooks/usePointerDepth.ts');
    expect(hook).toMatch(/\(hover: hover\) and \(pointer: fine\)/);
    expect(hook).toMatch(/prefers-reduced-motion: reduce/);
  });
});
