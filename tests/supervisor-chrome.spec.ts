// SV-G (bright-vault-33): Supervisor header and composer chrome. Desktop has a single History
// control beside Dock chat; phone has a ⋯ menu and no Back on a direct visit. A newer message
// shows an in-flow "New messages" marker inside the history scroller that focuses the latest row.
// Conversation data is a labelled [Fixture] injected through a fetch wrapper because the
// mock contract has no supervisor history.
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const conv = "11111111-2222-4333-8444-555555555555", me = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const EVIDENCE = process.env.SV_G_EVIDENCE;

function item(i: number) {
  const t0 = Date.parse("2026-11-03T10:00:00Z");
  const human = i % 2 === 0, n = Math.floor(i / 2) + 1, cursor = human ? String(n) : `${n}.1`;
  const body = human ? `[Fixture] Question ${n}: what changed in the queue?` : `[Fixture] Reply ${n}: nothing was created. This line is long enough to wrap on a phone so the history has real height.`;
  const base = { message_id: `00000000-1111-4111-8111-${String(i + 1).padStart(12, "0")}`, thread_id: conv, conversation_id: conv, cursor, body, body_digest: "sha256:" + createHash("sha256").update(body).digest("hex"), created_at_ms: t0 + i * 60000, logical_admission: "queued", agent_receipt: null };
  return human ? { ...base, author: { kind: "human", user_id: me }, host_delivery: "delivered" }
    : { ...base, author: { kind: "supervisor", actor_id: "22222222-3333-4444-8555-666666666666", generation: 1, session_id: "33333333-4444-4555-8666-777777777777" }, host_delivery: "not_attempted", dispatch: { dispatch_id: "44444444-5555-4666-8777-888888888888", host_operation_id: "55555555-6666-4777-8888-999999999999", batch_digest: "a".repeat(64) } };
}

async function inject(page: Page, count: number) {
  const items = Array.from({ length: count }, (_, i) => item(i)), newer = [item(count), item(count + 1)];
  const conversation = { id: conv, revision: "1", label: "Global supervisor" };
  const runtime = { state: "unavailable", binding: null, reason: "central_runtime_not_connected" };
  const discovery = { contract: "human-supervisor-conversation-1", conversation, runtime, limits: { body_bytes: 16384, context_refs: 16, attachments: 4, history_page: 16 } };
  const caps = ["supervisor.history.read", "supervisor.conversation", "dashboard.actions", "supervisor.message.enqueue"];
  await page.addInitScript(({ conv, me, caps, discovery, items, newer }) => {
    const store = [...items];
    (window as unknown as { __svAppendNewer: () => void }).__svAppendNewer = () => { store.push(...newer); };
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
    const wrap = (inner: typeof fetch): typeof fetch => async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      if (url.pathname === "/api/human/conversations/global") return json(discovery);
      if (url.pathname === `/api/human/conversations/${conv}/messages`) {
        const before = url.searchParams.get("before"), after = url.searchParams.get("after");
        const through = store.at(-1)!.cursor.split(".")[0];
        const base = { contract: discovery.contract, conversation: discovery.conversation, runtime: discovery.runtime, through_cursor: through };
        if (after !== null) {
          const page = store.slice(store.findIndex(entry => entry.cursor === after) + 1).slice(0, 16);
          return json({ ...base, direction: "forward", items: page, has_more: false, next_cursor: null });
        }
        const end = before ? store.findIndex(entry => entry.cursor === before) : store.length;
        const page = store.slice(Math.max(0, end - 16), end), more = end > 16;
        return json({ ...base, direction: "backward", items: page, has_more: more, next_cursor: more ? page[0]!.cursor : null });
      }
      const response = await inner(input, init);
      if (url.pathname !== "/api/v1/bootstrap") return response;
      const body = await response.clone().json();
      body.data.principal.id = me;
      body.data.global_supervisor = { ...body.data.global_supervisor, status: "available", conversation_id: conv };
      body.data.capabilities = [...body.data.capabilities.filter((c: { name: string }) => !caps.includes(c.name)), ...caps.map(name => ({ name, version: "1", enabled: true }))];
      return json(body);
    };
    let current = wrap(window.fetch.bind(window));
    Object.defineProperty(window, "fetch", { configurable: true, get: () => current, set: (value: typeof fetch) => { current = wrap(value); } });
  }, { conv, me, caps, discovery, items, newer });
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(", ")}`)).toEqual([]);
}

/** Scroll away from the latest row, add newer messages and use the in-flow marker. */
async function newMessageMarker(page: Page, shot: string) {
  const region = page.getByRole("region", { name: /history/i });
  const rows = region.locator("[data-message-id]");
  await region.evaluate(e => { e.scrollTop = 0; e.dispatchEvent(new Event("scroll")); });
  await page.evaluate(() => (window as unknown as { __svAppendNewer: () => void }).__svAppendNewer());
  // The page's own background refresh picks the newer page up.
  const marker = region.getByRole("button", { name: /new messages/i });
  await expect(marker).toBeVisible({ timeout: 10000 });
  const markerBox = (await marker.boundingBox())!, regionBox = (await region.boundingBox())!;
  expect(markerBox.y + markerBox.height).toBeLessThanOrEqual(regionBox.y + regionBox.height);
  expect(markerBox.y).toBeGreaterThan(regionBox.y + regionBox.height / 2);
  if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/${shot}` });
  await axe(page);
  await marker.click();
  await expect(rows.last()).toBeFocused();
  await expect(rows.last()).toContainText("[Fixture] Reply 12");
  await expect(marker).toHaveCount(0);
}

test.describe("desktop 1440x900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test("History control, icon send, footer, avatars and in-flow new-message marker", async ({ page }) => {
    await inject(page, 22);
    await page.goto("/supervisor");
    const region = page.getByRole("region", { name: /history/i });
    await expect(region.locator("[data-message-id]")).toHaveCount(16, { timeout: 15000 });
    await expect(page.getByRole("heading", { level: 1, name: "Global supervisor" })).toBeVisible();
    await expect(page.getByText("Global conversation · All projects")).toBeVisible();
    const history = page.getByRole("button", { name: /history/i }); // strict: exactly one
    await expect(history).toBeVisible();
    await expect(page.getByRole("button", { name: "Dock chat" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^back$/i })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: /message the global supervisor/i })).toBeVisible();
    const send = page.getByRole("button", { name: "Send" });
    await expect(send).toBeVisible();
    await expect(send.getByText("Send", { exact: true })).toBeHidden();
    await expect(page.getByText("Global conversation · draft preserved across views")).toBeVisible();
    await expect(region.locator("[data-author=supervisor]").first().getByText("aq", { exact: true })).toBeVisible();
    // Messages and composer share one column width.
    const list = (await page.getByRole("list", { name: "Supervisor messages" }).boundingBox())!;
    const form = (await page.getByRole("textbox", { name: /message the global supervisor/i }).locator("xpath=ancestor::form").boundingBox())!;
    expect(Math.abs(list.width - form.width)).toBeLessThanOrEqual(32);
    await region.evaluate(e => { e.scrollTop = e.scrollHeight; });
    if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/after-desktop.png` });
    await history.click();
    await expect(page.getByRole("button", { name: "Refresh messages" })).toBeVisible();
    if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/after-desktop-menu.png` });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Refresh messages" })).toBeHidden();
    await expect(history).toBeFocused();
    await axe(page);
    await newMessageMarker(page, "after-desktop-marker.png");
  });
});

test.describe("phone 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("⋯ menu, no Back on a direct visit, visible Send text and in-flow marker", async ({ page }) => {
    await inject(page, 22);
    await page.goto("/supervisor");
    const region = page.getByRole("region", { name: /history/i });
    await expect(region.locator("[data-message-id]")).toHaveCount(16, { timeout: 15000 });
    await expect(page.getByText("Global · All projects")).toBeVisible();
    // Scoped to the page header: the shell's bottom nav has its own "More" button.
    const more = page.locator("main header").getByRole("button", { name: /more|⋯/i });
    await expect(more).toBeVisible();
    await expect(page.getByRole("button", { name: /^back$/i })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: /message the global supervisor/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send" }).getByText("Send", { exact: true })).toBeVisible();
    await expect(page.getByText("Global conversation · draft preserved across views")).toBeHidden();
    await region.evaluate(e => { e.scrollTop = e.scrollHeight; });
    if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/after-phone.png` });
    await more.click();
    await expect(page.getByRole("button", { name: "Refresh messages" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Latest message" })).toBeVisible();
    if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/after-phone-menu.png` });
    await axe(page);
    await page.keyboard.press("Escape");
    await expect(more).toBeFocused();
    await newMessageMarker(page, "after-phone-marker.png");
    // 320px reflow: header controls and composer stay inside the viewport.
    await page.setViewportSize({ width: 320, height: 700 });
    await expect(more).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/after-phone-320.png` });
  });
});
