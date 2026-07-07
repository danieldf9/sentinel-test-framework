import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SentinelStore } from '@sentinel/core';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function seededStore(artifactsDir: string): SentinelStore {
  const store = new SentinelStore(':memory:');
  store.ensureRun('run-1', 'sha-1', 'auto');
  store.recordTestResult({
    runId: 'run-1',
    testId: 'shop.spec.ts::checkout',
    title: 'checkout flow',
    file: 'shop.spec.ts',
    status: 'passed_unverified',
    durationMs: 1200,
    error: null,
    flakyTagged: false,
  });
  store.recordHeal({
    runId: 'run-1',
    testId: 'shop.spec.ts::checkout',
    stepId: 's1',
    intent: 'Place order button',
    oldLocator: "locator('.btn-order')",
    newLocator: "getByRole('button', { name: 'Submit order' })",
    tier: 1,
    confidence: 0.91,
    mode: 'UNVERIFIED',
    reasoning: 'fuzzy DOM match',
    // A path INSIDE artifactsDir must map to a servable /artifacts URL.
    screenshotBefore: path.join(artifactsDir, 'run-1', 'checkout', 'before.jpg'),
    screenshotAfter: null,
    gitSha: 'sha-1',
  });
  store.finishRun('run-1', 'passed_unverified', { tests: 1 });
  return store;
}

describe('Studio read API', () => {
  it('serves summary, runs, run detail (with screenshot URL mapping), flake, and cost', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'sentinel-server-'));
    const store = seededStore(dir);
    const app = await buildApp({ store, artifactsDir: dir, webDir: null });

    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.json()).toEqual({ ok: true });

    const runs = await app.inject({ method: 'GET', url: '/api/runs' });
    expect(runs.statusCode).toBe(200);
    const runList = runs.json();
    expect(runList).toHaveLength(1);
    expect(runList[0].id).toBe('run-1');
    expect(runList[0].tests).toBe(1);

    const detail = await app.inject({ method: 'GET', url: '/api/runs/run-1' });
    expect(detail.statusCode).toBe(200);
    const body = detail.json();
    expect(body.overview.id).toBe('run-1');
    expect(body.detail.heals).toHaveLength(1);
    // absolute filesystem path rewritten to a servable, containment-checked URL
    expect(body.detail.heals[0].screenshotBefore).toBe('/artifacts/run-1/checkout/before.jpg');
    expect(body.detail.heals[0].screenshotAfter).toBeNull();

    const missing = await app.inject({ method: 'GET', url: '/api/runs/does-not-exist' });
    expect(missing.statusCode).toBe(404);

    const flake = await app.inject({ method: 'GET', url: '/api/flake' });
    expect(flake.statusCode).toBe(200);

    const cost = await app.inject({ method: 'GET', url: '/api/llm-costs' });
    expect(cost.json()).toHaveProperty('totalCostUsd');

    await app.close();
    store.close();
  });

  it('reports no-runs on an empty store', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'sentinel-server-'));
    const store = new SentinelStore(':memory:');
    const app = await buildApp({ store, artifactsDir: dir, webDir: null });

    const summary = await app.inject({ method: 'GET', url: '/api/summary' });
    expect(summary.json().status).toBe('no-runs');
    const runs = await app.inject({ method: 'GET', url: '/api/runs' });
    expect(runs.json()).toEqual([]);

    await app.close();
    store.close();
  });
});
