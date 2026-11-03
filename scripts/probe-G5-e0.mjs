#!/usr/bin/env node
// Read-only compatibility evidence for the retained E0 stack. This does not
// replace probe-core-overview.mjs or qualify the G4 aggregation contract.
import { chromium, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

if (!process.env.AQ_LIVE_URL || !process.env.AQ_LIVE_PROJECT_ID || !process.env.AQ_LIVE_OUTPUT_DIR) {
  throw new Error('AQ_LIVE_URL, AQ_LIVE_PROJECT_ID and AQ_LIVE_OUTPUT_DIR are required');
}
const origin = new URL(process.env.AQ_LIVE_URL);
if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
  throw new Error('AQ_LIVE_URL must be an origin without credentials');
}
const project = process.env.AQ_LIVE_PROJECT_ID;
const output = process.env.AQ_LIVE_OUTPUT_DIR;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const errors = [], mutations = [], captures = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
context.on('request', request => {
  if (!['GET', 'HEAD'].includes(request.method())) mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
});
const get = async path => {
  const response = await context.request.get(new URL(path, origin).href);
  expect(response.status()).toBe(200);
  return response.json();
};
try {
  const manifest = await context.request.get(new URL('/dashboard-manifest.json', origin).href);
  expect(manifest.status()).toBe(200);
  const bytes = await manifest.body();
  expect(sha(bytes)).toBe(sha(await readFile(new URL('../dist/dashboard-manifest.json', import.meta.url))));
  const built = JSON.parse(bytes);
  for (const [path, entry] of Object.entries(built.files)) {
    const asset = await context.request.get(new URL(`/${path}`, origin).href);
    expect(asset.status()).toBe(200);
    expect(sha(await asset.body())).toBe(entry.sha256);
  }
  const bootstrap = await get('/api/v1/bootstrap');
  const overview = await get(`/api/v1/overview?${new URLSearchParams({ scope: `project:${project}` })}`);
  const source = await get(`/api/human/overview/tasks?${new URLSearchParams({ project_id: project, project_limit: '4', task_limit: '16' })}`);
  const observed = source.projects.find(row => row.project.id === project && row.source_status === 'available' && row.tasks.length > 0);
  expect(observed).toBeTruthy();
  const task = observed.tasks[0];
  expect(overview.coverage.state).toBe('partial');
  for (const count of Object.values(overview.data.counts)) expect(count).toEqual({ value: null, accuracy: 'unknown' });
  const url = new URL(`/overview?${new URLSearchParams({ scope: `project:${project}` })}`, origin).href;
  for (const [width, height] of [[1440, 1100], [900, 1000], [390, 844], [320, 740]]) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height });
    page.setDefaultTimeout(10_000);
    await page.goto(url, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { level: 1, name: 'Overview', exact: true })).toBeVisible();
    await expect(page.getByText('Attention may be incomplete.', { exact: true })).toBeVisible();
    await expect(page.getByText('Nothing needs your attention', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Work counts' })).toContainText('—');
    await page.getByText('Recorded task details', { exact: true }).click();
    const tasks = page.getByRole('region', { name: 'Recorded tasks', exact: true });
    const link = tasks.getByRole('link', { name: task.title, exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', `/work/${task.id}?scope=project%3A${project}`);
    const work = await page.getByRole('region', { name: 'Work in motion', exact: true }).boundingBox();
    const infrastructure = await page.getByRole('complementary', { name: 'Infrastructure observations' }).boundingBox();
    if (width >= 1200) expect(infrastructure.x).toBeGreaterThan(work.x + work.width - 1);
    else expect(infrastructure.y).toBeGreaterThan(work.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    if (width < 768) await expect(page.getByRole('navigation', { name: 'Primary (compact)', exact: true })).toBeInViewport();
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(() => scrollTo(0, 0));
    const name = `overview-${width}`;
    await page.screenshot({ path: join(output, `${name}.png`), fullPage: true });
    await page.screenshot({ path: join(output, `${name}-viewport.png`) });
    captures.push(name);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/work/${task.id}\\?scope=project%3A${project}$`));
    await expect(page.getByRole('heading', { name: task.title, exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'Overview', exact: true })).toBeVisible();
    await page.close();
  }
  expect(errors).toEqual([]);
  expect(mutations).toEqual([]);
  const requirements = JSON.parse(await readFile(new URL('../src/app/bundle-requirements.json', import.meta.url)));
  const result = {
    passed: true, qualification: 'E0 compatibility subset only; G4 live/full-page acceptance deferred to G11',
    origin: origin.origin, project_id: project, task_id: task.id,
    browser_interception: false, bundle_manifest_sha256: `sha256:${sha(bytes)}`, bundle_source: built.source,
    verified_asset_count: Object.keys(built.files).length, captures, page_errors: errors, mutations,
    overview_coverage: overview.coverage, overview_sources_present: Array.isArray(overview.data.sources),
    quota_capability: bootstrap.data.capabilities.find(capability => capability.name === 'provider.quota'),
    missing_capabilities: requirements.required_capabilities.filter(name => !bootstrap.data.capabilities.some(capability => capability.name === name && capability.version === '1')),
    recorded_tasks_coverage: source.coverage,
  };
  await writeFile(join(output, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
