import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, SCHEMA_VERSION } from '../src/storage/db.js';
import { exportDatabase, importDatabase } from '../src/storage/exportImport.js';
import { SentinelStore, type HealRecord } from '../src/storage/store.js';

const dirs: string[] = [];
function tempDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sentinel-db-'));
  dirs.push(dir);
  return path.join(dir, 'sentinel.db');
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function version(dbPath: string): number {
  const db = openDatabase(dbPath);
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as {
    value: string;
  };
  db.close();
  return Number(row.value);
}

/** Rewinds a current database to what a v1 install looks like on disk. */
function rewindToV1(dbPath: string): void {
  const db = openDatabase(dbPath);
  db.exec(`DROP TABLE local_runs; UPDATE meta SET value = '1' WHERE key = 'schema_version';`);
  db.close();
}

const heal = (over: Partial<HealRecord> = {}): HealRecord => ({
  runId: 'r1',
  testId: 't1',
  stepId: 's1',
  intent: 'buy',
  oldLocator: "locator('#buy')",
  newLocator: "getByRole('button')",
  tier: 0,
  confidence: 0.95,
  mode: 'AUTO',
  reasoning: 'cached',
  screenshotBefore: null,
  screenshotAfter: null,
  gitSha: null,
  ...over,
});

describe('schema migrations', () => {
  it('a new database lands on the current version', () => {
    expect(version(tempDb())).toBe(SCHEMA_VERSION);
  });

  it('upgrades an existing database in place and keeps its rows', () => {
    const dbPath = tempDb();
    const store = new SentinelStore(dbPath);
    store.ensureRun('r1', null, 'auto');
    store.recordHeal(heal());
    store.close();
    rewindToV1(dbPath);

    const upgraded = new SentinelStore(dbPath);
    expect(upgraded.driftedLocator('t1', 's1')).toBe("locator('#buy')");
    expect(upgraded.resolveLocalRun(1, () => 'run-a')).toBe('run-a');
    upgraded.close();
    expect(version(dbPath)).toBe(SCHEMA_VERSION);
  });

  it('reopening is idempotent', () => {
    const dbPath = tempDb();
    expect(version(dbPath)).toBe(SCHEMA_VERSION);
    expect(version(dbPath)).toBe(SCHEMA_VERSION);
  });

  it('refuses a database from a newer Sentinel instead of corrupting it', () => {
    const dbPath = tempDb();
    const db = openDatabase(dbPath);
    db.exec(`UPDATE meta SET value = '999' WHERE key = 'schema_version'`);
    db.close();
    expect(() => openDatabase(dbPath)).toThrow(/newer than this build/);
  });
});

describe('importing exports across versions', () => {
  it('accepts an older export, so a CI cache survives an upgrade', () => {
    const source = new SentinelStore(':memory:');
    source.ensureRun('r1', null, 'auto');
    const older = { ...exportDatabase(source.db), schemaVersion: 1 };
    const target = new SentinelStore(':memory:');
    expect(() => importDatabase(target.db, older)).not.toThrow();
  });

  it('rejects an export from a newer build', () => {
    const target = new SentinelStore(':memory:');
    const newer = { ...exportDatabase(target.db), schemaVersion: SCHEMA_VERSION + 1 };
    expect(() => importDatabase(target.db, newer)).toThrow(/newer than this build/);
  });
});

describe('resolveLocalRun', () => {
  const NOW = 1_000_000_000;
  const mint = (id: string) => () => id;

  it('workers of one invocation share a run', () => {
    const s = new SentinelStore(':memory:');
    expect(s.resolveLocalRun(100, mint('first'), NOW)).toBe('first');
    expect(s.resolveLocalRun(100, mint('second'), NOW + 1000)).toBe('first');
  });

  it('separate invocations get separate runs', () => {
    const s = new SentinelStore(':memory:');
    expect(s.resolveLocalRun(100, mint('a'), NOW)).toBe('a');
    expect(s.resolveLocalRun(200, mint('b'), NOW)).toBe('b');
  });

  it('a recycled pid after the idle window starts a new run', () => {
    const s = new SentinelStore(':memory:');
    s.resolveLocalRun(100, mint('old'), NOW);
    expect(s.resolveLocalRun(100, mint('new'), NOW + 16 * 60_000)).toBe('new');
  });

  it('activity keeps a long run alive past the idle window', () => {
    const s = new SentinelStore(':memory:');
    s.resolveLocalRun(100, mint('long'), NOW);
    s.touchLocalRun(100, NOW + 14 * 60_000);
    expect(s.resolveLocalRun(100, mint('other'), NOW + 28 * 60_000)).toBe('long');
  });

  it('does not accumulate rows for dead runners', () => {
    const s = new SentinelStore(':memory:');
    s.resolveLocalRun(100, mint('old'), NOW);
    s.resolveLocalRun(200, mint('new'), NOW + 3 * 60 * 60_000);
    const { n } = s.db.prepare('SELECT COUNT(*) AS n FROM local_runs').get() as { n: number };
    expect(n).toBe(1);
  });
});

describe('driftedLocator', () => {
  it.each(['AUTO', 'UNVERIFIED', 'HUMAN'] as const)('reports a live %s heal', (mode) => {
    const s = new SentinelStore(':memory:');
    s.recordHeal(heal({ mode }));
    expect(s.driftedLocator('t1', 's1')).toBe("locator('#buy')");
  });

  it('ignores suggestions, which were never applied', () => {
    const s = new SentinelStore(':memory:');
    s.recordHeal(heal({ mode: 'SUGGESTED' }));
    expect(s.driftedLocator('t1', 's1')).toBeNull();
  });

  it('ignores promoted heals: the spec has the new locator now', () => {
    const s = new SentinelStore(':memory:');
    s.recordHeal(heal());
    s.db.exec('UPDATE heals SET promoted = 1');
    expect(s.driftedLocator('t1', 's1')).toBeNull();
  });

  it('uses the latest heal when a step drifted more than once', () => {
    const s = new SentinelStore(':memory:');
    s.recordHeal(heal({ oldLocator: "locator('#first')" }));
    s.recordHeal(heal({ oldLocator: "locator('#second')" }));
    expect(s.driftedLocator('t1', 's1')).toBe("locator('#second')");
  });
});
