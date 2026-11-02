#!/usr/bin/env node
// Explicitly SYNTHETIC terminal wire on a source-dev UI; real read-only page
// metadata may be proxied. This is not a real worker/input delivery qualification.
import { chromium, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const origin = process.env.AQ_TERMINAL_PORT_URL ?? 'http://127.0.0.1:4241';
const output = process.env.AQ_TERMINAL_PORT_OUTPUT ?? '/tmp/aq-terminal-port-ui';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const session = '9767942b-b7f8-5ae4-be04-136f81509cce';
const tid = 'e0e2f83e-f5ed-4147-8aad-2f4a076b6229';
const terminal = { terminal_id: tid, epoch: 1, session: { kind: 'remote', session_id: session, node_id: '368300e0-f275-4d61-bb5f-a4ae7867315a', boot_id: 'bdbfe42d-0629-45dc-8fb2-b7b490cd8f3e', attempt_id: '38a3fe3a-5e17-589c-87fa-893754037804', assignment_generation: 1 } };
let generation = 0, lease = null, sequence = 0; const frames = [], subscriptions = new Map(), receipts = new Map(), inputs = [], mutations = [], errors = [];
const append = text => { const bytes = [...Buffer.from(text)]; frames.push({ terminal, sequence: ++sequence, byte_length: bytes.length, bytes, digest: createHash('sha256').update(Buffer.from(bytes)).digest('hex') }); };
append('\x1b[?1049h\x1b[2J\x1b[H\x1b[36mSynthetic terminal port fixture\x1b[0m\r\n\r\nV1 xterm renderer · v2 finite-input transport\r\n\r\n› ');
const control = () => ({ terminal, session_revision: 1, generation, lease, fence_acknowledged: !!lease, input_paused: false });
page.on('pageerror', e => errors.push(e.message));
await page.route('**/api/v1/bootstrap', async route => { const response = await route.fetch(); const json = await response.json(); for (const cap of json.data.capabilities) if (cap.name === 'terminal.control') { cap.enabled = true; delete cap.reason; } await route.fulfill({ response, json }); });
await page.route('**/api/v1/terminals/**', async route => {
  const request = route.request(), url = new URL(request.url()); const now = Date.now(); let body;
  if (request.method() === 'POST') {
    const doc = request.postDataJSON(); mutations.push(doc.kind); const r = doc.body;
    if (doc.kind === 'watch') { const id = crypto.randomUUID(); subscriptions.set(id, r.expires_at_ms); body = { kind: 'watch', body: { terminal, operation_id: r.operation_id, subscription_id: id, session_revision: 1, expires_at_ms: r.expires_at_ms } }; }
    else if (doc.kind === 'control' || doc.kind === 'renew') { if (doc.kind === 'control') generation++; lease = { terminal, principal_id: 'fixture', lease_id: lease?.lease_id ?? crypto.randomUUID(), generation, issued_at_ms: now, expires_at_ms: r.expires_at_ms, execution_expires_at_ms: now + 60000 }; body = { kind: 'control', body: { operation_id: r.operation_id, status: control() } }; }
    else if (doc.kind === 'input') { expect(lease).not.toBeNull(); inputs.push(r.bytes); const receipt = { terminal, operation_id: r.operation_id, disposition: 'applied', input_paused: false, observed_at_ms: now }; receipts.set(r.operation_id, receipt); append(Buffer.from(r.bytes).toString()); body = { kind: 'input', body: receipt }; }
    else if (doc.kind === 'resize') body = { kind: 'resize', body: { terminal, operation_id: r.operation_id, sequence: r.sequence } };
    else if (doc.kind === 'release') { lease = null; generation++; body = { kind: 'released', body: { terminal, operation_id: r.operation_id, generation } }; }
    else throw new Error(`Unexpected mutation ${doc.kind}`);
  } else if (url.pathname.endsWith('/tail')) { const after = Number(url.searchParams.get('after_sequence')); const id = url.searchParams.get('subscription_id'); body = { terminal, subscription_id: id, session_revision: 1, expires_at_ms: subscriptions.get(id), server_time_ms: now, last_observed_at_ms: now, availability: 'resident_tail', disconnected: false, initial_incomplete: true, frames: frames.filter(f => f.sequence > after), gaps: [], next_sequence: sequence, more: false }; }
  else if (url.pathname.includes('/receipts/')) body = receipts.get(url.pathname.split('/').at(-1));
  else body = { terminal, session_revision: 1, input_mode: 'finite_v1', terminal_policy: { input_enabled: true }, disconnected: false, control: control() };
  await route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'aq-terminal-server-time-ms': String(now) }, body: JSON.stringify(body) });
});
try {
  await page.goto(`${origin}/agents/${session}`);
  const pane = page.getByRole('region', { name: 'Interactive agent terminal' });
  await expect(pane.getByRole('button', { name: 'Take control' })).toBeEnabled();
  expect(inputs).toHaveLength(0);
  await pane.getByRole('button', { name: 'Take control' }).click();
  await expect(pane.getByRole('button', { name: 'Type', exact: true })).toBeEnabled();
  await pane.getByRole('button', { name: 'Type', exact: true }).click();
  await page.keyboard.type('hello'); await page.keyboard.press('Enter');
  await expect.poll(() => Buffer.from(inputs.flat()).toString()).toContain('hello\r');
  const captures = [];
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 740]]) {
    await page.setViewportSize({ width, height }); await page.waitForTimeout(300); await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const file = `terminal-${width}.png`; await page.screenshot({ path: `${output}/${file}`, fullPage: true }); captures.push(file);
  }
  await pane.getByRole('button', { name: 'Release', exact: true }).click(); await expect(pane.getByRole('button', { name: 'Type', exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
  const result = { passed: true, qualification: 'SYNTHETIC source-dev terminal wire, actual xterm renderer; no real worker/input delivery claim', origin, captures, input_bytes: inputs.flat().length, mutations, errors };
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); }
