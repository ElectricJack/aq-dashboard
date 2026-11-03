// Labelled fixtures: compiled Overview/shared shell and mock Work navigation.
// Start pnpm preview on 4318 and pnpm dev:mock on 4317 before running.
import { chromium, expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const output = fileURLToPath(new URL('./', import.meta.url));
const root = new URL('../../../../', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const fixture = name => json(`contracts/pinned/dashboard-read/v1/fixtures/${name}.json`);
const manifest = await readFile(new URL('dist/dashboard-manifest.json', root));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bootstrap = await fixture('bootstrap');
const requirements = await json('src/app/bundle-requirements.json');
bootstrap.data.capabilities = requirements.required_capabilities.map(name => ({ name, version: '1', enabled: ['dashboard.overview', 'projects.read', 'sessions.read', 'provider.quota'].includes(name), reason: 'Unavailable in labelled screenshot fixture' }));
bootstrap.data.principal.display_name = 'Browser repair fixture';
const browser = await chromium.launch();
const captures = [], errors = [];
await mkdir(output, { recursive: true });
try {
  for (const [width, height] of [[1440, 900], [390, 844], [320, 640]]) {
    for (const path of ['/overview', '/work/aq-104', '/work?view=graph&root=aq-104']) {
      const compiled = path === '/overview';
      const origin = `http://127.0.0.1:${compiled ? 4318 : 4317}`;
      const page = await browser.newPage({ viewport: { width, height } });
      page.on('pageerror', error => errors.push(error.message));
      if (compiled) {
        const served = await page.request.get(`${origin}/dashboard-manifest.json`);
        expect(sha(await served.body())).toBe(sha(manifest));
        await page.route('**/api/**', async route => {
          const path = new URL(route.request().url()).pathname;
          const name = { '/api/v1/overview': 'overview-nonempty', '/api/v1/provider-usage': 'provider-usage-nonempty', '/api/v1/projects': 'projects', '/api/v1/sessions': 'sessions' }[path];
          return path === '/api/v1/bootstrap' ? route.fulfill({ json: bootstrap }) : name ? route.fulfill({ json: await fixture(name) }) : route.fulfill({ status: 503, json: {} });
        });
      }
      await page.goto(`${origin}${path}`);
      await expect(page.getByRole('heading', { level: 1, name: compiled ? 'Overview' : 'Work' })).toBeVisible();
      if (compiled) await expect(page.getByRole('list', { name: 'Work counts' })).toBeVisible();
      else await expect(path.includes('graph') ? page.getByRole('region', { name: 'Dependency graph' }) : page.getByRole('heading', { level: 2, name: 'Replay reconciliation' })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      const name = `${compiled ? 'overview-compiled' : path.includes('graph') ? 'work-graph-mock' : 'work-detail-mock'}-${width}.png`;
      await page.screenshot({ path: `${output}${name}` });
      captures.push(name);
      await page.close();
    }
  }
  expect(errors).toEqual([]);
  await writeFile(`${output}captures.json`, JSON.stringify({ label: 'Deterministic fixture screenshots; not live API qualification', bundle_manifest_sha256: sha(manifest), source: JSON.parse(manifest).source, captures, errors }, null, 2) + '\n');
} finally { await browser.close(); }
