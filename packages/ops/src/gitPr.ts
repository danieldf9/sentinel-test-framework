import { spawnSync } from 'node:child_process';
import type { SentinelStore } from '@sentinel/core';
import { applyPromotions, planPromotions, type PromotionPlan } from './promote.js';

export interface PromotePreview {
  plans: PromotionPlan[];
  /** Human-readable diff lines (from a write:false apply — no files touched). */
  diff: string[];
}

/**
 * Preview promotions without touching files or the DB: plan the reviewed heals,
 * then run a dry (`write:false`) apply to produce the diff. Safe to call from the
 * server for the "review before Open PR" screen.
 */
export function previewPromotions(
  store: SentinelStore,
  rootDir: string,
  opts: { includeUnverified?: boolean } = {},
): PromotePreview {
  const plans = planPromotions(store, rootDir, opts);
  const { diff } = applyPromotions(store, plans, { write: false });
  return { plans, diff };
}

export interface PromoteAndPrOptions {
  /** Branch to create for the promotion (default sentinel/promote-<ts>). */
  branch?: string;
  /** PR base branch (default: the branch checked out when promotion starts). */
  base?: string;
  includeUnverified?: boolean;
  /** GitHub token; when absent the change is committed locally but no PR opens. */
  githubToken?: string;
  /** Push the branch to the remote (default true when a token is present). */
  push?: boolean;
  remote?: string;
  title?: string;
  body?: string;
}

export interface PromoteAndPrResult {
  applied: number;
  filesChanged: string[];
  diff: string[];
  branch: string | null;
  base: string | null;
  committed: boolean;
  pushed: boolean;
  prUrl: string | null;
  note: string;
  plans: PromotionPlan[];
}

interface GitHubRepo {
  owner: string;
  repo: string;
}

/** Parse `git@github.com:owner/repo.git` or `https://github.com/owner/repo(.git)`. */
export function parseGitHubRemote(url: string): GitHubRepo | null {
  const s = url.trim();
  const ssh = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(s);
  if (ssh) return { owner: ssh[1]!, repo: ssh[2]! };
  const https = /^https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(s);
  if (https) return { owner: https[1]!, repo: https[2]! };
  return null;
}

function git(args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return {
    status: r.status ?? 1,
    stdout: (r.stdout ?? '').trim(),
    stderr: (r.stderr ?? '').trim(),
  };
}

/**
 * Git-free promotion: write reviewed heals back into spec files, create a branch,
 * commit, and (optionally) push + open a PR via the GitHub API. Only the files
 * changed by the promotion are staged, so unrelated working-tree edits are never
 * committed. When no token is supplied the change is committed locally and the
 * caller is told to open the PR themselves.
 */
export async function promoteAndOpenPr(
  store: SentinelStore,
  rootDir: string,
  opts: PromoteAndPrOptions = {},
): Promise<PromoteAndPrResult> {
  const plans = planPromotions(store, rootDir, { includeUnverified: opts.includeUnverified });
  const ready = plans.filter((p) => p.status === 'ready');
  const base = opts.base ?? (git(['rev-parse', '--abbrev-ref', 'HEAD'], rootDir).stdout || null);
  const empty: PromoteAndPrResult = {
    applied: 0,
    filesChanged: [],
    diff: [],
    branch: null,
    base,
    committed: false,
    pushed: false,
    prUrl: null,
    note: 'nothing ready to promote',
    plans,
  };
  if (ready.length === 0) return empty;

  const branch = (opts.branch ?? `sentinel/promote-${Date.now()}`).replace(/[^\w./-]/g, '-');
  const created = git(['checkout', '-b', branch], rootDir);
  if (created.status !== 0) {
    return { ...empty, note: `git checkout -b ${branch} failed: ${created.stderr}` };
  }

  const { applied, filesChanged, diff } = applyPromotions(store, plans, { write: true });
  if (applied === 0) {
    git(['checkout', base ?? '-'], rootDir);
    return { ...empty, branch, note: 'no files changed by promotion' };
  }

  git(['add', ...filesChanged], rootDir);
  const commit = git(
    ['commit', '-m', `chore(sentinel): promote ${applied} healed locator(s) into specs`],
    rootDir,
  );
  const committed = commit.status === 0;

  let pushed = false;
  let prUrl: string | null = null;
  let note = committed
    ? 'committed locally; set a GitHub token to open a PR automatically'
    : `commit failed: ${commit.stderr}`;

  const remote = opts.remote ?? 'origin';
  const shouldPush = committed && (opts.push ?? Boolean(opts.githubToken));
  if (shouldPush) {
    const push = git(['push', '-u', remote, branch], rootDir);
    pushed = push.status === 0;
    if (!pushed) note = `branch committed but push failed: ${push.stderr}`;
  }

  if (committed && pushed && opts.githubToken) {
    const remoteUrl = git(['remote', 'get-url', remote], rootDir).stdout;
    const gh = parseGitHubRemote(remoteUrl);
    if (!gh) {
      note = `pushed, but could not parse a GitHub repo from ${remote} (${remoteUrl}); open the PR manually`;
    } else {
      try {
        const { Octokit } = await import('@octokit/rest');
        const octokit = new Octokit({ auth: opts.githubToken });
        const pr = await octokit.pulls.create({
          owner: gh.owner,
          repo: gh.repo,
          head: branch,
          base: base ?? 'main',
          title: opts.title ?? `Sentinel: promote ${applied} healed locator(s)`,
          body:
            opts.body ??
            ['Automated locator promotion from Sentinel Studio.', '', ...diff].join('\n'),
        });
        prUrl = pr.data.html_url;
        note = 'PR opened';
      } catch (err) {
        note = `pushed, but opening the PR failed: ${String((err as Error).message)}`;
      }
    }
  }

  return { applied, filesChanged, diff, branch, base, committed, pushed, prUrl, note, plans };
}
