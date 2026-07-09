import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LoadedConfig } from '@sentinel/core';
import { makeStepId, makeTestId, SentinelStore } from '@sentinel/core';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** Flow routes only read loaded.rootDir; a partial is enough for tests. */
const loadedFor = (rootDir: string): LoadedConfig => ({ rootDir }) as unknown as LoadedConfig;

const HAND_SPEC = `import { test } from '@sentinel/core';

test('cart badge updates', async ({ page, s }) => {
  await s.goto('/products');
  await s.click({ locator: page.locator('#add-1'), intent: 'Add to cart button' });
  await s.expectText({ locator: page.getByTestId('count'), intent: 'Cart badge', text: '1' });
});
`;

describe('flow routes', () => {
  it('creates, lists, reads, and saves flows (recompiling the generated spec)', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'sentinel-flows-'));
    mkdirSync(path.join(dir, 'specs'));
    writeFileSync(path.join(dir, 'specs', 'existing.spec.ts'), HAND_SPEC);
    const store = new SentinelStore(':memory:');
    const app = await buildApp({ store, artifactsDir: dir, webDir: null, loaded: loadedFor(dir) });

    // Create: lands next to the existing specs.
    const created = await app.inject({
      method: 'POST',
      url: '/api/flows',
      payload: { title: 'My first flow' },
    });
    expect(created.statusCode).toBe(200);
    const flowPath = created.json().path as string;
    expect(flowPath).toBe('specs/my-first-flow.flow.json');
    expect(existsSync(path.join(dir, 'specs', 'my-first-flow.flow.spec.ts'))).toBe(true);

    // List + read back.
    const list = await app.inject({ method: 'GET', url: '/api/flows' });
    expect(list.json()).toHaveLength(1);
    const one = await app.inject({
      method: 'GET',
      url: `/api/flows/one?path=${encodeURIComponent(flowPath)}`,
    });
    expect(one.json().flow.title).toBe('My first flow');

    // Save with a step; the generated spec picks it up.
    const flow = {
      version: 1,
      title: 'My first flow',
      steps: [
        { action: 'goto', url: '/products' },
        {
          action: 'click',
          stepKey: 'k1',
          intent: 'Add to cart',
          locator: { kind: 'testid', value: 'add-1' },
        },
      ],
    };
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/flows',
      payload: { path: flowPath, flow },
    });
    expect(saved.statusCode).toBe(200);
    const spec = readFileSync(path.join(dir, 'specs', 'my-first-flow.flow.spec.ts'), 'utf8');
    expect(spec).toContain(`stepKey: 'k1',`);
    expect(spec).toContain(`page.getByTestId('add-1')`);

    // Path traversal is refused.
    const evil = await app.inject({
      method: 'PUT',
      url: '/api/flows',
      payload: { path: '../outside.flow.json', flow },
    });
    expect(evil.statusCode).toBe(400);

    await app.close();
    store.close();
  });

  it('rekeys the test identity when a flow title is renamed', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'sentinel-flows-'));
    const store = new SentinelStore(':memory:');
    const app = await buildApp({ store, artifactsDir: dir, webDir: null, loaded: loadedFor(dir) });

    const created = await app.inject({
      method: 'POST',
      url: '/api/flows',
      payload: {
        title: 'old name',
        flow: {
          version: 1,
          title: 'old name',
          steps: [
            {
              action: 'click',
              stepKey: 'k1',
              intent: 'x',
              locator: { kind: 'css', value: '#x' },
            },
          ],
        },
      },
    });
    const flowPath = created.json().path as string;
    const specRel = flowPath.replace(/\.flow\.json$/, '.flow.spec.ts');
    const oldTestId = makeTestId(specRel, [path.basename(specRel), 'old name']);
    store.upsertCacheEntry({
      testId: oldTestId,
      stepId: 'k1',
      primary: { kind: 'css', value: '#x' },
      alternates: [],
      fingerprint: {
        tag: 'button',
        role: 'button',
        name: 'x',
        text: 'x',
        id: null,
        testId: null,
        classes: [],
        attributes: {},
        nearbyText: '',
        labelText: '',
        cssPath: 'body > button:nth-of-type(1)',
      },
      intent: 'x',
      lastVerifiedAt: 1,
    });

    const renamed = await app.inject({
      method: 'PUT',
      url: '/api/flows',
      payload: {
        path: flowPath,
        flow: {
          version: 1,
          title: 'new name',
          steps: [
            { action: 'click', stepKey: 'k1', intent: 'x', locator: { kind: 'css', value: '#x' } },
          ],
        },
      },
    });
    expect(renamed.json().rekeyedRows).toBeGreaterThanOrEqual(1);
    const newTestId = makeTestId(specRel, [path.basename(specRel), 'new name']);
    expect(store.getCacheEntry(newTestId, 'k1')).not.toBeNull();
    expect(store.getCacheEntry(oldTestId, 'k1')).toBeNull();

    await app.close();
    store.close();
  });

  it('imports a hand-authored spec: flows written, history migrated, original retired', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'sentinel-flows-'));
    mkdirSync(path.join(dir, 'specs'));
    const specAbs = path.join(dir, 'specs', 'cart.spec.ts');
    writeFileSync(specAbs, HAND_SPEC);

    const store = new SentinelStore(':memory:');
    // History under the OLD identities: derived step id inside the old file's testId.
    const oldTestId = makeTestId('specs/cart.spec.ts', ['cart.spec.ts', 'cart badge updates']);
    const oldStepId = makeStepId('click', 'Add to cart button', 0);
    store.upsertCacheEntry({
      testId: oldTestId,
      stepId: oldStepId,
      primary: { kind: 'css', value: '#add-1' },
      alternates: [],
      fingerprint: {
        tag: 'button',
        role: 'button',
        name: 'Add to cart',
        text: 'Add to cart',
        id: null,
        testId: null,
        classes: [],
        attributes: {},
        nearbyText: '',
        labelText: '',
        cssPath: 'body > button:nth-of-type(1)',
      },
      intent: 'Add to cart button',
      lastVerifiedAt: 1,
    });

    const app = await buildApp({ store, artifactsDir: dir, webDir: null, loaded: loadedFor(dir) });

    // Probe listing sees it as importable.
    const probe = await app.inject({ method: 'GET', url: '/api/flows/importable' });
    const entry = probe.json().find((e: { path: string }) => e.path === 'specs/cart.spec.ts');
    expect(entry.importable).toBe(true);

    const imported = await app.inject({
      method: 'POST',
      url: '/api/flows/import',
      payload: { specPath: 'specs/cart.spec.ts' },
    });
    expect(imported.statusCode).toBe(200);
    const body = imported.json();
    expect(body.flows).toHaveLength(1);
    expect(body.movedRows).toBeGreaterThanOrEqual(1);
    expect(body.retired).toBe('specs/cart.spec.ts.imported');
    expect(existsSync(specAbs)).toBe(false);
    expect(existsSync(`${specAbs}.imported`)).toBe(true);

    // The cache row followed the test to its new identity AND its new stepKey.
    const flowRel = body.flows[0].path as string;
    const newSpecRel = flowRel.replace(/\.flow\.json$/, '.flow.spec.ts');
    const newTestId = makeTestId(newSpecRel, [path.basename(newSpecRel), 'cart badge updates']);
    const flowDoc = JSON.parse(readFileSync(path.join(dir, flowRel), 'utf8'));
    const clickKey = flowDoc.steps[1].stepKey as string;
    expect(store.getCacheEntry(newTestId, clickKey)?.primary).toEqual({
      kind: 'css',
      value: '#add-1',
    });
    expect(store.getCacheEntry(oldTestId, oldStepId)).toBeNull();

    // Generated specs are not offered for import again.
    const probe2 = await app.inject({ method: 'GET', url: '/api/flows/importable' });
    expect(
      probe2.json().find((e: { path: string }) => e.path.endsWith('.flow.spec.ts')),
    ).toBeUndefined();

    await app.close();
    store.close();
  });
});
