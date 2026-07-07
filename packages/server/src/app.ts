import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { SentinelStore } from '@sentinel/core';
import {
  buildRunSummary,
  queryFlakeStats,
  queryLlmCosts,
  queryRunDetail,
  queryRunsOverview,
} from '@sentinel/report';
import Fastify, { type FastifyInstance } from 'fastify';

export interface AppDeps {
  store: SentinelStore;
  /** Absolute dir holding heal before/after screenshots (loaded.artifactsDir). */
  artifactsDir: string;
  /** Built @sentinel/web dist to serve as the SPA, or null to run API-only. */
  webDir: string | null;
}

/** Recent runs to scan when resolving a single run's overview (local, single-user). */
const RUN_LOOKUP_LIMIT = 200;

/**
 * Build the Studio Fastify app. The store is injected so the app is testable
 * with an in-memory DB. Read endpoints reuse the shared query functions in
 * @sentinel/report so the dashboard and the static HTML report never diverge.
 */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Heal screenshots are written under artifactsDir; serve that tree read-only.
  await app.register(fastifyStatic, {
    root: deps.artifactsDir,
    prefix: '/artifacts/',
    decorateReply: false,
  });

  // Map a stored absolute screenshot path to a servable URL, but only if it is
  // genuinely inside artifactsDir (containment guard against path traversal).
  const shotUrl = (abs: string | null): string | null => {
    if (!abs) return null;
    const rel = path.relative(deps.artifactsDir, abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return `/artifacts/${rel.split(path.sep).join('/')}`;
  };

  app.get('/api/health', async () => ({ ok: true }));

  // Structured run summary (drop the GitHub-comment markdown field).
  app.get('/api/summary', async () => {
    const { markdown: _markdown, ...counts } = buildRunSummary(deps.store);
    return counts;
  });

  app.get<{ Querystring: { limit?: string } }>('/api/runs', async (req) => {
    const raw = Number(req.query.limit ?? 20);
    const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 20, 1), RUN_LOOKUP_LIMIT);
    return queryRunsOverview(deps.store, limit);
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id', async (req, reply) => {
    const overview =
      queryRunsOverview(deps.store, RUN_LOOKUP_LIMIT).find((o) => o.id === req.params.id) ?? null;
    if (!overview) {
      reply.code(404);
      return { error: 'run not found' };
    }
    const detail = queryRunDetail(deps.store, req.params.id);
    // Rewrite filesystem screenshot paths into servable /artifacts URLs.
    const heals = detail.heals.map((h) => ({
      ...h,
      screenshotBefore: shotUrl(h.screenshotBefore),
      screenshotAfter: shotUrl(h.screenshotAfter),
    }));
    return { overview, detail: { ...detail, heals } };
  });

  app.get('/api/flake', async () => queryFlakeStats(deps.store));
  app.get('/api/llm-costs', async () => queryLlmCosts(deps.store));

  // SPA: serve the built web assets and fall back to index.html for client routes.
  if (deps.webDir) {
    await app.register(fastifyStatic, {
      root: deps.webDir,
      prefix: '/',
      wildcard: false,
    });
    app.setNotFoundHandler((req, reply) => {
      if (
        req.method === 'GET' &&
        !req.url.startsWith('/api') &&
        !req.url.startsWith('/artifacts')
      ) {
        return reply.sendFile('index.html');
      }
      reply.code(404).send({ error: 'not found' });
    });
  }

  return app;
}
