import { useCallback, useReducer } from 'react';
import { recall, remember } from '../state/listMemory';

/**
 * `useState` that keeps its value for the browser tab under `key`
 * (`state/listMemory.ts`), so a list comes back where the reader left it.
 * A different key is a different list: it starts at `initial` (or at what it
 * was left at, if it was visited before).
 */
export function useRemembered<T>(
  key: string,
  initial: T,
  valid?: (v: unknown) => v is T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const value = recall(key, initial, valid);
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const prev = recall(key, initial, valid);
      const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      if (Object.is(v, prev)) return;
      remember(key, v);
      rerender();
    },
    // `initial` and `valid` are constants at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return [value, set];
}
