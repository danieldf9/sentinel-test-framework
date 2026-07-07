/**
 * @sentinel/server — Sentinel Studio local server entry point.
 *
 * `startStudioServer` loads the project's Sentinel config, opens the state DB,
 * and serves the JSON API + the built web dashboard on localhost. Called by the
 * CLI's `sentinel studio` command (M3).
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, SentinelStore } from '@sentinel/core';
import { buildApp } from './app.js';

export { buildApp, type AppDeps } from './app.js';

export interface StudioServerOptions {
  /** Port to listen on (default 4300). */
  port?: number;
  /** Open the dashboard in a browser once listening (default true). */
  open?: boolean;
  /** Directory to resolve sentinel.config.ts / the state DB from (default cwd). */
  cwd?: string;
}

export interface StudioServer {
  port: number;
  url: string;
  close(): Promise<void>;
}

const DEFAULT_PORT = 4300;
const HOST = '127.0.0.1';

function safeUsername(): string | null {
  try {
    return os.userInfo().username || null;
  } catch {
    return null;
  }
}

/** Locate the built @sentinel/web dist, or null if it has not been built yet. */
function resolveWebDir(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve('@sentinel/web/package.json');
    const dir = path.join(path.dirname(pkgJson), 'dist');
    return existsSync(path.join(dir, 'index.html')) ? dir : null;
  } catch {
    return null;
  }
}

export async function startStudioServer(opts: StudioServerOptions = {}): Promise<StudioServer> {
  const loaded = await loadConfig(opts.cwd ?? process.cwd());
  const store = new SentinelStore(loaded.dbPath);
  const webDir = resolveWebDir();
  if (!webDir) {
    console.warn(
      '[sentinel] web dashboard not built — serving API only. Run `pnpm --filter @sentinel/web build`.',
    );
  }

  const actor = process.env.USER ?? process.env.USERNAME ?? safeUsername() ?? 'studio';
  const app = await buildApp({ store, artifactsDir: loaded.artifactsDir, webDir, actor });
  const port = opts.port ?? DEFAULT_PORT;
  await app.listen({ port, host: HOST });
  const url = `http://${HOST}:${port}`;

  if (opts.open !== false) {
    try {
      const open = (await import('open')).default;
      await open(url);
    } catch {
      // Opening a browser is best-effort; the URL is printed by the caller.
    }
  }

  return {
    port,
    url,
    async close() {
      await app.close();
      store.close();
    },
  };
}
