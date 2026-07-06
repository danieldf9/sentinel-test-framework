import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { quoteForShell } from '../src/shell.js';
import { buildWorkflowTemplate, detectPackageManager } from '../src/templates.js';

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('detectPackageManager', () => {
  it('detects the lockfile, walking up for workspaces', () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'sentinel-pm-'));
    writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
    const nested = path.join(dir, 'packages', 'app');
    mkdirSync(nested, { recursive: true });
    expect(detectPackageManager(nested)).toBe('pnpm'); // found at the workspace root

    writeFileSync(path.join(nested, 'yarn.lock'), '');
    expect(detectPackageManager(nested)).toBe('yarn'); // nearest lockfile wins
  });

  it('defaults to npm when no lockfile exists', () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'sentinel-pm-'));
    expect(detectPackageManager(dir)).toBe('npm');
  });
});

describe('buildWorkflowTemplate', () => {
  it('generates the matching install steps per package manager', () => {
    expect(buildWorkflowTemplate('npm')).toContain('npm ci');
    expect(buildWorkflowTemplate('pnpm')).toContain('pnpm install --frozen-lockfile');
    expect(buildWorkflowTemplate('pnpm')).toContain('pnpm/action-setup@');
    expect(buildWorkflowTemplate('yarn')).toContain('yarn install --frozen-lockfile');
    expect(buildWorkflowTemplate('yarn')).not.toContain('npm ci');
  });
});

describe('quoteForShell (Windows/POSIX arg safety)', () => {
  it('leaves shell-safe args untouched', () => {
    expect(quoteForShell('--shard=1/2', 'win32')).toBe('--shard=1/2');
    expect(quoteForShell('playwright', 'linux')).toBe('playwright');
  });

  it('quotes args with spaces so grep patterns survive shell: true', () => {
    expect(quoteForShell('my test name', 'win32')).toBe('"my test name"');
    expect(quoteForShell('my test name', 'linux')).toBe(`'my test name'`);
  });

  it('escapes embedded quotes', () => {
    expect(quoteForShell('say "hi"', 'win32')).toBe('"say \\"hi\\""');
    expect(quoteForShell(`it's here`, 'linux')).toBe(`'it'\\''s here'`);
  });
});
