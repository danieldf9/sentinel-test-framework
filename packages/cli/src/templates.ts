import { existsSync } from 'node:fs';
import path from 'node:path';

export const CONFIG_TEMPLATE = `import { defineConfig } from '@sentinel/core';

export default defineConfig({
  testIdAttribute: 'data-testid',
  healing: {
    mode: 'auto',
  },
  // Consent banners are never auto-accepted silently. Declare them explicitly:
  // preSteps: [{ name: 'accept cookies', selector: '[data-testid=consent-accept]' }],
});
`;

export type PackageManager = 'npm' | 'pnpm' | 'yarn';

/** The scaffolded workflow must install with the project's own package manager
 * — an `npm ci` in a pnpm/yarn workspace fails on the missing package-lock. */
export function detectPackageManager(cwd: string): PackageManager {
  let dir = path.resolve(cwd);
  for (;;) {
    if (existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
    if (existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
    if (existsSync(path.join(dir, 'package-lock.json'))) return 'npm';
    const parent = path.dirname(dir);
    if (parent === dir) return 'npm';
    dir = parent;
  }
}

const SETUP_STEPS: Record<PackageManager, string> = {
  npm: `- uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci`,
  pnpm: `- uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile`,
  yarn: `- uses: actions/setup-node@v4
        with: { node-version: 22, cache: yarn }
      - run: yarn install --frozen-lockfile`,
};

export function buildWorkflowTemplate(pm: PackageManager): string {
  return `# Sentinel CI (scaffolded by \`sentinel init\` for a ${pm} project)
#
# - Restores the locator cache (portable JSON export) from actions/cache
# - Runs the suite with healing; degrades to deterministic-only Tiers 0-1
#   when no LLM secret is configured
# - Uploads the HTML report (with heal screenshots) as an artifact
# - Posts/updates a single PR summary comment incl. pending escalations
# - Saves the updated locator cache
#
# Answer escalations from a PR comment: /sentinel choose <id> <label>
# (requires the sentinel-escalation-answer.yml companion workflow).
name: sentinel

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  pull-requests: write
  checks: write

jobs:
  sentinel:
    runs-on: ubuntu-latest
    env:
      SENTINEL_LLM_API_KEY: \${{ secrets.SENTINEL_LLM_API_KEY }}
      SENTINEL_RUN_ID: gh-\${{ github.run_id }}
    steps:
      - uses: actions/checkout@v4
      ${SETUP_STEPS[pm]}
      - run: npx playwright install --with-deps chromium

      - name: Restore locator cache
        uses: actions/cache/restore@v4
        with:
          path: .sentinel-ci/cache.json
          key: sentinel-\${{ github.ref_name }}-\${{ github.run_id }}
          restore-keys: |
            sentinel-\${{ github.ref_name }}-
            sentinel-
      - name: Import locator cache
        run: test -f .sentinel-ci/cache.json && npx sentinel db import .sentinel-ci/cache.json || echo "no cache yet"

      - name: Run suite with healing
        run: npx sentinel run

      - name: Report + summary
        if: always()
        run: |
          npx sentinel report --out sentinel-report
          npx sentinel summary --run "$SENTINEL_RUN_ID" --out sentinel-report/summary.md >> "$GITHUB_STEP_SUMMARY"
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: sentinel-report
          path: sentinel-report

      - name: PR summary comment
        if: always() && github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const marker = '<!-- sentinel-summary -->';
            const body = marker + '\\n' + fs.readFileSync('sentinel-report/summary.md', 'utf8');
            const { data: comments } = await github.rest.issues.listComments({
              ...context.repo, issue_number: context.issue.number, per_page: 100 });
            const existing = comments.find(c => c.body && c.body.includes(marker));
            if (existing) {
              await github.rest.issues.updateComment({ ...context.repo, comment_id: existing.id, body });
            } else {
              await github.rest.issues.createComment({ ...context.repo, issue_number: context.issue.number, body });
            }

      - name: Export locator cache
        if: always()
        run: mkdir -p .sentinel-ci && npx sentinel db export --json .sentinel-ci/cache.json
      - name: Save locator cache
        if: always()
        uses: actions/cache/save@v4
        with:
          path: .sentinel-ci/cache.json
          key: sentinel-\${{ github.ref_name }}-\${{ github.run_id }}
`;
}
