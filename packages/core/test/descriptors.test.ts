import type { Page } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import {
  describeDescriptor,
  descriptorsFromFingerprint,
  firstUniqueDescriptor,
} from '../src/descriptors.js';
import { makeStepId, makeTestId } from '../src/ids.js';
import { makeFp } from './helpers.js';

describe('descriptorsFromFingerprint — fallback ladder (spec §4 Tier 0)', () => {
  it('ranks testid → role+name → placeholder → text → css → positional path', () => {
    const fp = makeFp({
      testId: 'place-order',
      role: 'button',
      name: 'Place order',
      text: 'Place order',
      classes: ['btn', 'btn-order'],
      attributes: { placeholder: '' },
    });
    const kinds = descriptorsFromFingerprint(fp).map((d) => d.kind);
    expect(kinds[0]).toBe('testid');
    expect(kinds[1]).toBe('role');
    expect(kinds).toContain('text');
    expect(kinds[kinds.length - 1]).toBe('css'); // positional path is always last
  });

  it('derives label candidates only for form controls', () => {
    const input = makeFp({
      tag: 'input',
      role: 'textbox',
      labelText: 'Email',
      name: 'Email',
      text: '',
      attributes: { placeholder: 'you@example.com' },
    });
    const ds = descriptorsFromFingerprint(input);
    expect(ds.some((d) => d.kind === 'label' && d.value === 'Email')).toBe(true);
    expect(ds.some((d) => d.kind === 'placeholder')).toBe(true);
    expect(ds.some((d) => d.kind === 'text')).toBe(false); // never text-match an input

    const button = makeFp({ labelText: 'stray', text: 'Click me', name: 'Click me' });
    expect(descriptorsFromFingerprint(button).some((d) => d.kind === 'label')).toBe(false);
  });
});

describe('describeDescriptor', () => {
  it('renders human-auditable locator strings', () => {
    expect(describeDescriptor({ kind: 'testid', value: 'x' })).toBe(`getByTestId('x')`);
    expect(describeDescriptor({ kind: 'css', value: '#a' })).toBe(`locator('#a')`);
  });
});

describe('stable ids', () => {
  it('testId and stepId are deterministic and collision-resistant', () => {
    expect(makeTestId('specs\\shop.spec.ts', ['shop', 'checkout'])).toBe(
      'specs/shop.spec.ts::shop > checkout',
    );
    const a = makeStepId('click', 'Add to cart button', 0);
    expect(a).toBe(makeStepId('click', 'Add to cart button', 0));
    expect(a).not.toBe(makeStepId('click', 'Add to cart button', 1));
    expect(a).not.toBe(makeStepId('fill', 'Add to cart button', 0));
    expect(a).toMatch(/^s_[0-9a-f]{12}$/);
  });
});

describe('firstUniqueDescriptor', () => {
  const role = { kind: 'role', value: 'button', name: 'Add to cart', exact: true } as const;
  const path = { kind: 'css', value: 'body > section:nth-of-type(2) > button' } as const;
  const pageWith = (counts: { role: number; css: number | Error }) =>
    ({
      getByRole: () => ({ count: async () => counts.role }),
      locator: () => ({
        count: async () => {
          if (counts.css instanceof Error) throw counts.css;
          return counts.css;
        },
      }),
    }) as unknown as Page;

  it('skips a locator that matches several identical widgets', async () => {
    const page = pageWith({ role: 2, css: 1 });
    expect(await firstUniqueDescriptor(page, [role, path])).toBe(path);
  });

  it('keeps the ranking when the best descriptor is unique', async () => {
    const page = pageWith({ role: 1, css: 1 });
    expect(await firstUniqueDescriptor(page, [role, path])).toBe(role);
  });

  it('falls back to the best-ranked when none is unique or one cannot parse', async () => {
    const page = pageWith({ role: 2, css: new Error('bad selector') });
    expect(await firstUniqueDescriptor(page, [role, path])).toBe(role);
  });
});
