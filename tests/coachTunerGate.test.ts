import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isPaid, sectionAllowed, type Access } from '../src/state/tiers';

/**
 * THE COACH ASSIST TUNER IS PRO, NOT MEMBERS (2026-09-27, asked for).
 *
 * "Switch a card", "Or bring one of these" and "A full loadout" sat on the
 * admin staging shelf. They are gated on `isPaid` now — paid Pro or admin,
 * never a trial ("Member") — which is the same line Coach Assist itself sits
 * behind. A source contract, because this suite runs in `node` with no DOM.
 */
const SRC = readFileSync(
  fileURLToPath(new URL('../src/components/Analytics/CoachAssist.tsx', import.meta.url)),
  'utf-8',
);
const ALL: Access[] = ['anon', 'free', 'trial', 'pro', 'admin'];

describe('the Coach Assist tuner is Pro, not Members', () => {
  it('is gated on isPaid, not on admin', () => {
    expect(SRC).toMatch(/const tunerAllowed = isPaid\(useAccess\(\)\);/);
    expect(SRC).not.toMatch(/useAccess\(\) === 'admin'/);
  });

  it('gates the REQUEST as well as the render, so nobody else pays the swap scan', () => {
    expect(SRC).toMatch(/\{ days \}, tunerAllowed, kind\)/);
    expect(SRC).toMatch(/\{tunerAllowed && data\.tuner && <TunerPanel/);
  });

  it('opens for Pro and admin and never for a Member (trial), free or anonymous reader', () => {
    expect(ALL.filter((a) => isPaid(a))).toEqual(['pro', 'admin']);
  });

  it('reaches exactly the readers who can open Coach Assist', () => {
    for (const a of ALL) expect(isPaid(a), a).toBe(sectionAllowed(a, 'Coach Assist'));
  });
});
