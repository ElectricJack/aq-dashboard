// G11 visual suite: one surface per accepted mockup (docs/design/manifest.json) plus Settings.
// Fixture runs use the labelled mock contract (`vite --mode mock`); the supervisor surfaces add a
// labelled [Fixture] conversation because the mock contract has no supervisor history.
import { createHash } from "node:crypto";
import { expect, type Page } from "@playwright/test";

export const PROJECT = "00000000-0000-0000-0000-000000000001";
const scope = `scope=project:${PROJECT}`;
const ROOT = "00000000-0000-0000-0000-000000000003";
const DOC = "00000000-0000-0000-0000-000000000005";
const DECISION = "00000000-0000-4000-8000-000000000001";

export const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900, kind: "desktop" },
  { name: "tablet-1024", width: 1024, height: 768, kind: "tablet" },
  { name: "tablet-768", width: 768, height: 1024, kind: "tablet" },
  { name: "phone-390", width: 390, height: 844, kind: "phone" },
  { name: "phone-320", width: 320, height: 640, kind: "phone" },
] as const;
export type Viewport = (typeof VIEWPORTS)[number];

export type Surface = {
  id: string;
  /** Manifest file names this surface is reviewed against; Settings has none. */
  assets: string[];
  path: string;
  /** Wait until the surface's own content (not only the shell) has rendered. */
  ready: (page: Page, vp: Viewport) => Promise<void>;
  /** Optional step after ready that opens the presentation the mockup shows. */
  open?: (page: Page, vp: Viewport) => Promise<void>;
  fixture?: (page: Page) => Promise<void>;
};

const h = (page: Page, level: number, name: string | RegExp) => page.getByRole("heading", { level, name }).first();

export const SURFACES: Surface[] = [
  {
    id: "overview", assets: ["01-overview-v3.png"], path: `/overview?${scope}`,
    ready: async (page) => { await expect(h(page, 1, "Overview")).toBeVisible(); await expect(page.getByRole("region", { name: "Capacity" })).toBeVisible(); },
  },
  {
    id: "work", assets: ["02-work-explorer-v3.png"], path: `/work/${ROOT}?${scope}&view=graph&root=${ROOT}`,
    ready: async (page) => { await expect(page.getByRole("region", { name: "Dependency graph" })).toBeVisible(); },
  },
  {
    id: "decisions", assets: ["03-decision-workspace-v3.png"], path: `/decisions/${DECISION}`,
    ready: async (page) => { await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible(); await expect(page.getByRole("button", { name: /Approve/ }).first()).toBeAttached(); },
  },
  {
    id: "supervisor-docked", assets: ["04-supervisor-chat.png"], path: `/overview?${scope}`, fixture: supervisorFixture,
    ready: async (page) => { await expect(h(page, 1, "Overview")).toBeVisible(); await expect(page.getByRole("region", { name: "Capacity" })).toBeVisible(); },
    // The dock exists only on wide desktop; tablet and phone open the full page (0002 §9).
    open: async (page, vp) => {
      if (vp.kind === "desktop") await page.getByRole("button", { name: "Open supervisor" }).click();
      else await page.goto("/supervisor");
      await expect(page.getByText("[Fixture] Reply 1:", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    },
  },
  {
    id: "playbooks", assets: ["06-playbooks.png"], path: "/playbooks/runs/run-0000000000000284",
    ready: async (page) => { await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible(); },
  },
  {
    id: "knowledge", assets: ["07-knowledge-v2.png"], path: `/knowledge/${DOC}?${scope}`,
    // Wide desktop shows library + document; tablet and phone show the one detail pane (0002 §9).
    ready: async (page, vp) => {
      await expect(h(page, 2, "Fixture: execution ownership")).toBeVisible();
      if (vp.kind === "desktop") await expect(page.getByRole("list", { name: "Knowledge records" })).toBeVisible();
    },
  },
  {
    id: "agents", assets: ["08-agents-focus-desktop.png", "11-agent-mobile-v2.png"], path: "/agents/sess-07",
    ready: async (page) => { await expect(h(page, 2, "Worker 07")).toBeAttached(); await expect(page.getByRole("status").filter({ hasText: "Watch only" })).toBeVisible(); },
  },
  {
    id: "supervisor-full", assets: ["09-supervisor-full-desktop.png", "12-supervisor-mobile.png"], path: "/supervisor", fixture: supervisorFixture,
    ready: async (page) => {
      await expect(h(page, 1, "Global supervisor")).toBeVisible();
      await expect(page.getByText("[Fixture] Reply 1:", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    },
  },
  {
    id: "results", assets: ["10-results-desktop-v2.png", "13-results-mobile-v2.png"], path: "/results",
    ready: async (page) => { await expect(page.getByRole("list", { name: "Results feed" }).getByRole("article").first()).toBeVisible(); },
  },
  {
    id: "settings", assets: [], path: "/settings",
    ready: async (page) => { await expect(h(page, 1, "Settings")).toBeVisible(); await expect(page.getByRole("region", { name: "Display" })).toBeVisible(); },
  },
];

/** Labelled [Fixture] supervisor conversation injected through a fetch wrapper (as in supervisor-viewport.spec.ts). */
export async function supervisorFixture(page: Page) {
  const conv = "11111111-2222-4333-8444-555555555555", me = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const t0 = Date.parse("2026-11-03T10:00:00Z");
  const items = Array.from({ length: 6 }, (_, i) => {
    const human = i % 2 === 0, n = Math.floor(i / 2) + 1, cursor = human ? String(n) : `${n}.1`;
    const body = human ? `[Fixture] Question ${n}: what changed in the queue?` : `[Fixture] Reply ${n}: nothing was created. This reply is long enough to wrap so the history has real height.`;
    const base = { message_id: `00000000-1111-4111-8111-${String(i + 1).padStart(12, "0")}`, thread_id: conv, conversation_id: conv, cursor, body, body_digest: "sha256:" + createHash("sha256").update(body).digest("hex"), created_at_ms: t0 + i * 60000, logical_admission: "queued", agent_receipt: null };
    return human ? { ...base, author: { kind: "human", user_id: me }, host_delivery: "delivered" }
      : { ...base, author: { kind: "supervisor", actor_id: "22222222-3333-4444-8555-666666666666", generation: 1, session_id: "33333333-4444-4555-8666-777777777777" }, host_delivery: "not_attempted", dispatch: { dispatch_id: "44444444-5555-4666-8777-888888888888", host_operation_id: "55555555-6666-4777-8888-999999999999", batch_digest: "a".repeat(64) } };
  });
  const conversation = { id: conv, revision: "1", label: "Global supervisor" };
  const runtime = { state: "unavailable", binding: null, reason: "central_runtime_not_connected" };
  const discovery = { contract: "human-supervisor-conversation-1", conversation, runtime, limits: { body_bytes: 16384, context_refs: 16, attachments: 4, history_page: 16 } };
  const history = { contract: "human-supervisor-conversation-1", conversation, runtime, direction: "backward", through_cursor: "3", items, next_cursor: null, has_more: false };
  const caps = ["supervisor.history.read", "supervisor.conversation", "dashboard.actions", "supervisor.message.enqueue"];
  await page.addInitScript(({ conv, me, caps, discovery, history }) => {
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
    const wrap = (inner: typeof fetch): typeof fetch => async (input, init) => {
      const path = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href).pathname;
      if (path === "/api/human/conversations/global") return json(discovery);
      if (path === `/api/human/conversations/${conv}/messages`) return json(history);
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

export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Let layout, fonts and two paints settle before a capture (visual-acceptance.md). */
export async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
