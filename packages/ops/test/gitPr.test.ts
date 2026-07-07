import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SentinelStore } from '@sentinel/core';
import { afterEach, describe, expect, it } from 'vitest';
import { parseGitHubRemote, promoteAndOpenPr } from '../src/gitPr.js';

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const g = (args: string[], cwd: string) => spawnSync('git', args, { cwd, encoding: 'utf8' });

function initRepo(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'sentinel-gitpr-'));
  g(['init', '-b', 'main'], d);
  g(['config', 'user.email', 'test@example.com'], d);
  g(['config', 'user.name', 'Test'], d);
  return d;
}

function seedHeal(store: SentinelStore, testId: string, stepId: string, oldLoc: string) {
  store.ensureRun('r1', 'sha', 'auto');
  store.recordHeal({
    runId: 'r1',
    testId,
    stepId,
    intent: 'Place order button',
    oldLocator: oldLoc,
    newLocator: 'stale',
    tier: 1,
    confidence: 0.92,
    mode: 'AUTO',
    reasoning: 'r',
    screenshotBefore: null,
    screenshotAfter: null,
    gitSha: 'sha',
  });
  store.upsertCacheEntry({
    testId,
    stepId,
    primary: { kind: 'role', value: 'button', name: 'Submit order', exact: true },
    alternates: [],
    fingerprint: {
      tag: 'button',
      role: 'button',
      name: 'Submit order',
      text: 'Submit order',
      id: null,
      testId: null,
      classes: [],
      attributes: {},
      nearbyText: '',
      labelText: '',
      cssPath: 'body > button:nth-of-type(1)',
    },
    intent: 'Place order button',
    lastVerifiedAt: Date.now(),
  });
}

describe('parseGitHubRemote', () => {
  it('parses ssh and https remotes', () => {
    expect(parseGitHubRemote('git@github.com:acme/widgets.git')).toEqual({
      owner: 'acme',
      repo: 'widgets',
    });
    expect(parseGitHubRemote('https://github.com/acme/widgets')).toEqual({
      owner: 'acme',
      repo: 'widgets',
    });
    expect(parseGitHubRemote('https://gitlab.com/acme/widgets.git')).toBeNull();
  });
});

describe('promoteAndOpenPr (local git verification, no token)', () => {
  it('branches, rewrites the spec, and commits without opening a PR', async () => {
    dir = initRepo();
    mkdirSync(path.join(dir, 'specs'));
    const spec = path.join(dir, 'specs', 'shop.spec.ts');
    writeFileSync(
      spec,
      `await s.click({ locator: page.locator('.btn-order'), intent: 'Place order button' });\n`,
    );
    g(['add', '-A'], dir);
    g(['commit', '-m', 'init'], dir);

    const store = new SentinelStore(':memory:');
    seedHeal(store, 'specs/shop.spec.ts::checkout', 's1', `locator('.btn-order')`);

    const result = await promoteAndOpenPr(store, dir, {
      branch: 'sentinel/test-promote',
      push: false,
    });

    expect(result.applied).toBe(1);
    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(false);
    expect(result.prUrl).toBeNull();
    expect(result.branch).toBe('sentinel/test-promote');
    expect(result.base).toBe('main');
    expect(result.note).toMatch(/set a GitHub token/i);

    // File rewritten to the cached primary.
    const content = readFileSync(spec, 'utf8');
    expect(content).toContain(`getByRole('button', { name: 'Submit order', exact: true })`);
    expect(content).not.toContain('.btn-order');

    // We are on the new branch with exactly one new commit staged from the promotion.
    expect(g(['rev-parse', '--abbrev-ref', 'HEAD'], dir).stdout.trim()).toBe(
      'sentinel/test-promote',
    );
    expect(g(['log', '-1', '--pretty=%s'], dir).stdout).toMatch(/promote 1 healed locator/);

    store.close();
  });

  it('does nothing when there is nothing ready to promote', async () => {
    dir = initRepo();
    writeFileSync(path.join(dir, 'x.txt'), 'x');
    g(['add', '-A'], dir);
    g(['commit', '-m', 'init'], dir);
    const store = new SentinelStore(':memory:');
    const result = await promoteAndOpenPr(store, dir, { push: false });
    expect(result.applied).toBe(0);
    expect(result.branch).toBeNull();
    expect(result.note).toMatch(/nothing ready/i);
    // Still on main — no branch created.
    expect(g(['rev-parse', '--abbrev-ref', 'HEAD'], dir).stdout.trim()).toBe('main');
    store.close();
  });
});
