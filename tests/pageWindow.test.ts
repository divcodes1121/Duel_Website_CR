import { describe, expect, it } from 'vitest';

import { pageWindow, type PageItem } from '../src/utils/pageWindow';

const numbers = (items: PageItem[]) => items.filter((i): i is number => typeof i === 'number');

describe('pageWindow', () => {
  it('draws every page when they all fit', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pageWindow(1, 5, 0)).toEqual([1, 2, 3, 4, 5]);
  });

  it('draws nothing for an empty list', () => {
    expect(pageWindow(1, 0)).toEqual([]);
  });

  it('windows around the current page', () => {
    expect(pageWindow(1, 10)).toEqual([1, 2, 3, 4, 5, 'end-gap', 10]);
    expect(pageWindow(5, 10)).toEqual([1, 'start-gap', 4, 5, 6, 'end-gap', 10]);
    expect(pageWindow(10, 10)).toEqual([1, 'start-gap', 6, 7, 8, 9, 10]);
    expect(pageWindow(5, 10, 0)).toEqual([1, 'start-gap', 5, 'end-gap', 10]);
  });

  // The property the control's layout depends on: the arrows never move.
  it('always returns the same number of items once pages exceed slots', () => {
    for (const sib of [0, 1, 2]) {
      const slots = 2 * sib + 5;
      for (const total of [slots + 1, 20, 59_337]) {
        for (let page = 1; page <= Math.min(total, 40); page++) {
          expect(pageWindow(page, total, sib)).toHaveLength(slots);
        }
        expect(pageWindow(total, total, sib)).toHaveLength(slots);
      }
    }
  });

  it('always includes the first, last and current page, in order, without repeats', () => {
    for (const sib of [0, 1, 2]) {
      for (const total of [1, 2, 6, 8, 13, 1000]) {
        for (let page = 1; page <= total; page++) {
          const nums = numbers(pageWindow(page, total, sib));
          expect(nums[0]).toBe(1);
          expect(nums[nums.length - 1]).toBe(total);
          expect(nums).toContain(page);
          for (let i = 1; i < nums.length; i++) expect(nums[i]).toBeGreaterThan(nums[i - 1]);
        }
      }
    }
  });

  // An ellipsis standing in for one page is a click the reader could have had.
  it('never uses a gap to hide a single page', () => {
    for (const sib of [0, 1]) {
      for (const total of [6, 7, 8, 9, 30]) {
        for (let page = 1; page <= total; page++) {
          const items = pageWindow(page, total, sib);
          items.forEach((item, i) => {
            if (typeof item === 'number') return;
            const before = items[i - 1] as number;
            const after = items[i + 1] as number;
            expect(after - before).toBeGreaterThan(2);
          });
        }
      }
    }
  });

  it('clamps a page outside the range rather than drawing it', () => {
    expect(pageWindow(0, 10)).toEqual(pageWindow(1, 10));
    expect(pageWindow(99, 10)).toEqual(pageWindow(10, 10));
    expect(pageWindow(Number.NaN, 10)).toEqual(pageWindow(1, 10));
  });
});
