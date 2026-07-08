import { describe, expect, it } from 'vitest';
import { assertValidStepKey, makeStepId, resolveStepId } from '../src/ids.js';

describe('assertValidStepKey', () => {
  it('accepts short identifier-safe keys', () => {
    expect(() => assertValidStepKey('k7f3a9')).not.toThrow();
    expect(() => assertValidStepKey('step.checkout:1-a_b')).not.toThrow();
  });

  it('rejects empty, oversized, or unsafe keys', () => {
    expect(() => assertValidStepKey('')).toThrow(/invalid stepKey/);
    expect(() => assertValidStepKey('has space')).toThrow(/invalid stepKey/);
    expect(() => assertValidStepKey('a'.repeat(65))).toThrow(/invalid stepKey/);
  });
});

describe('resolveStepId', () => {
  it('uses an explicit stepKey verbatim (stable across intent edits)', () => {
    const occ = new Map<string, number>();
    const used = new Set<string>();
    expect(resolveStepId('click', 'Checkout button', 'k1', occ, used, 't1')).toBe('k1');
    // Same key, DIFFERENT intent → still the same stable identity would be reused by
    // the flow; here a second logical step must carry a different key.
    expect(resolveStepId('click', 'Checkout button in header', 'k2', occ, used, 't1')).toBe('k2');
  });

  it('rejects a duplicate stepKey within one test', () => {
    const occ = new Map<string, number>();
    const used = new Set<string>();
    resolveStepId('click', 'a', 'dup', occ, used, 't1');
    expect(() => resolveStepId('click', 'b', 'dup', occ, used, 't1')).toThrow(/duplicate stepKey/);
  });

  it('falls back to the derived id (intent as anchor) when no stepKey is given', () => {
    const occ = new Map<string, number>();
    const used = new Set<string>();
    const first = resolveStepId('click', 'Add to cart', undefined, occ, used, 't1');
    expect(first).toBe(makeStepId('click', 'Add to cart', 0));
    // Repeated identical (action, intent) bumps the occurrence index.
    const second = resolveStepId('click', 'Add to cart', undefined, occ, used, 't1');
    expect(second).toBe(makeStepId('click', 'Add to cart', 1));
    expect(second).not.toBe(first);
    // Editing the intent yields a different derived id (the documented behavior).
    expect(resolveStepId('click', 'Add to bag', undefined, occ, used, 't1')).toBe(
      makeStepId('click', 'Add to bag', 0),
    );
  });
});
