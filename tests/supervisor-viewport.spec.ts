// SV-F (smart-glacier-73): the full Supervisor page fits the viewport; the history region is
// the only scroller and the composer stays visible above the phone bottom nav.
// Conversation data is a labelled [Fixture] injected through a fetch wrapper because the
// mock contract has no supervisor history and always reports the runtime as unavailable.
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const conv = "11111111-2222-4333-8444-555555555555", me = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const EVIDENCE = process.env.SV_F_EVIDENCE;

function fixture(count: number) {
  const t0 = Date.parse("2026-11-03T10:00:00Z");
  const items = Array.from({ length: count }, (_, i) => {
    const human = i % 2 === 0, n = Math.floor(i / 2) + 1, cursor = human ? String(n) : `${n}.1`;
    const body = human ? `[Fixture] Question ${n}: what changed in the queue?` : `[Fixture] Reply ${n}: nothing was created. This line is long enough to wrap on a phone so the history has real height.`;
    const base = { message_id: `00000000-1111-4111-8111-${String(i + 1).padStart(12, "0")}`, thread_id: conv, conversation_id: conv, cursor, body, body_digest: "sha256:" + createHash("sha256").update(body).digest("hex"), created_at_ms: t0 + i * 60000, logical_admission: "queued", agent_receipt: null };
    return human ? { ...base, author: { kind: "human", user_id: me }, host_delivery: "delivered" }
      : { ...base, author: { kind: "supervisor", actor_id: "22222222-3333-4444-8555-666666666666", generation: 1, session_id: "33333333-4444-4555-8666-777777777777" }, host_delivery: "not_attempted", dispatch: { dispatch_id: "44444444-5555-4666-8777-888888888888", host_operation_id: "55555555-6666-4777-8888-999999999999", batch_digest: "a".repeat(64) } };
  });
  const conversation = { id: conv, revision: "1", label: "Global supervisor" };
  const runtime = { state: "unavailable", binding: null, reason: "central_runtime_not_connected" };
  return {
    discovery: { contract: "human-supervisor-conversation-1", conversation, runtime, limits: { body_bytes: 16384, context_refs: 0, attachments: 0, history_page: 16 } },
    history: { contract: "human-supervisor-conversation-1", conversation, runtime, direction: "backward", through_cursor: String(Math.ceil(count / 2)), items, next_cursor: null, has_more: false },
  };
}

async function inject(page: Page, count: number) {
  const { discovery, history } = fixture(count);
  const caps = ["supervisor.history.read", "supervisor.conversation", "dashboard.actions", "supervisor.message.enqueue"];
  await page.addInitScript(({ conv, me, caps, discovery, history }) => {
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
    const wrap = (inner: typeof fetch): typeof fetch => async (input, init) => {
      const path = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href).pathname;
      if (path === "/api/human/conversations/global") return json(discovery);
      if (path === `/api/human/conversations/${conv}/messages`) {
        // Backward pages of at most 16, matching the contract's history_page.
        const before = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href).searchParams.get("before");
        const end = before ? history.items.findIndex(item => item.cursor === before) : history.items.length;
        const items = history.items.slice(Math.max(0, end - 16), end), more = end > 16;
        return json({ ...history, items, has_more: more, next_cursor: more ? items[0]!.cursor : null });
      }
      const response = await inner(input, init);
      if (path !== "/api/v1/bootstrap") return response;
      const body = await response.clone().json();
      body.data.principal.id = me;
      body.data.global_supervisor = { ...body.data.global_supervisor, status: "available", conversation_id: conv };
      body.data.capabilities = [...body.data.capabilities.filter((c: { name: string }) => !caps.includes(c.name)), ...caps.map(name => ({ name, version: "1", enabled: true }))];
      return json(body);
    };
    let current = wrap(window.fetch.bind(window));
    Object.defineProperty(window, "fetch", { configurable: true, get: () => current, set: (value: typeof fetch) => { current = wrap(value); } });
  }, { conv, me, caps, discovery, history });
}

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1024, height: 768 },
  { name: "phone", width: 390, height: 844 },
];

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("full Supervisor fits the viewport with a visible composer and one scroller", async ({ page }) => {
      await inject(page, 40);
      await page.goto("/supervisor");
      const region = page.getByRole("region", { name: "Conversation history" });
      const older = region.getByRole("button", { name: "Load older messages" });
      const rows = region.locator("[data-message-id]");
      await expect(rows).toHaveCount(16, { timeout: 15000 });
      // A background refresh can briefly own the history request, so retry the page-in.
      await expect(async () => { if (await rows.count() < 40) await older.click({ timeout: 1000 }); expect(await rows.count()).toBe(40); }).toPass({ timeout: 10000 });
      await expect(page.getByRole("heading", { level: 1, name: "Global supervisor" })).toBeVisible();
      await region.evaluate(e => { e.scrollTop = e.scrollHeight; });
      if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/supervisor-${vp.name}.png` });

      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(vp.height);
      expect(await page.evaluate(() => document.scrollingElement!.scrollHeight)).toBe(await page.evaluate(() => innerHeight));

      const send = page.getByRole("button", { name: /send/i });
      const box = (await send.boundingBox())!;
      const nav = page.getByRole("navigation", { name: "Primary (compact)" });
      const limit = vp.width < 768 ? (await nav.boundingBox())!.y : vp.height;
      expect(box.y + box.height).toBeLessThanOrEqual(limit);
      const title = (await page.getByRole("heading", { level: 1, name: "Global supervisor" }).boundingBox())!;
      expect(title.y).toBeGreaterThanOrEqual(0);

      // History is the only scroller: it moves, the window does not.
      const before = await region.evaluate(e => { e.scrollTop = e.scrollHeight; return e.scrollTop; });
      expect(await region.evaluate(e => e.scrollHeight > e.clientHeight)).toBe(true);
      await region.hover();
      await page.mouse.wheel(0, -600);
      await expect.poll(() => region.evaluate(e => e.scrollTop)).toBeLessThan(before);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      expect((await send.boundingBox())!.y).toBe(box.y);

      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(", ")}`)).toEqual([]);
    });
  });
}
