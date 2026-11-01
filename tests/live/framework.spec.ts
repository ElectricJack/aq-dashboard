import { expect, test, type Locator } from "@playwright/test";

// Read-only smoke against an explicitly configured actual AQ human listener.
// No MSW, route interception, provider calls or domain mutations.
test("production dashboard connects to AQ and supports direct navigation", async ({ page, request }) => {
  const response = await request.get("/api/v1/bootstrap");
  expect(response.status()).toBe(200);
  const bootstrap = await response.json();
  expect(bootstrap.api_version).toBe("dashboard-read-1");
  expect(bootstrap.data.capabilities.find((c: { name: string }) => c.name === "sessions.read").enabled).toBe(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const [path, title] of [["/overview", "Overview"], ["/agents", "Agents"], ["/settings", "Settings"]]) {
    await page.goto(path!);
    await expect(page.getByRole("heading", { level: 1, name: title! })).toBeVisible();
    await expect(page.getByRole("banner").getByText("Connected", { exact: true })).toBeVisible();
    await expect(page.getByText(/Mock data/)).toHaveCount(0);
  }
  await expect(page.getByText("Daemon: ok")).toBeVisible();
  const workers = await (await request.get("/api/workers")).json();
  if (workers.length) {
    await expect(page.getByRole("list", { name: "Worker nodes" })).toContainText(workers[0].name);
  } else {
    await expect(page.getByText("No worker nodes enrolled.")).toBeVisible();
  }
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("unsupported features are explicit and unknown API routes stay JSON errors", async ({ page, request }) => {
  await page.goto("/work");
  await expect(page.getByRole("heading", { name: "Work is not available" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Search/ })).toBeDisabled();
  const response = await request.get("/api/v1/not-a-route");
  expect(response.status()).toBe(404);
  expect(response.headers()["content-type"]).toContain("application/json");
  const missing = await request.get("/assets/missing.js");
  expect(missing.status()).toBe(404);
  expect(missing.headers()["content-type"]).not.toContain("text/html");
});

test("live settings remains usable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Framework connection" })).toBeVisible();
  await expect(page.getByText("Daemon: ok")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});

type SessionRead = {
  id: string;
  label: string;
  execution_authority?: string;
  observation: { state: string };
  terminal?: { type: string; id: string } | null;
  lifecycle?: { started_at: string | null; stopped_at: string | null } | null;
};

// Published presentation meaning, checked against the actual HTTP response rather
// than a fixture or an import of the UI's adapter/label implementation.
function centralState(value: string | undefined): string {
  return ({ offered: "Offered", preparing: "Preparing", granted: "Grant issued", cancelling: "Cancelling", never_granted: "Never granted", declined: "Declined", finished: "Finished", unknown: "Unknown" } as Record<string, string>)[value ?? "unknown"] ?? "Unsupported authority state";
}
async function expectLifecycle(container: Locator, session: SessionRead) {
  const history = session.lifecycle;
  if (!history) {
    await expect(container.getByText("Lifecycle history unavailable", { exact: true })).toBeVisible();
    await expect(container.locator("time")).toHaveCount(0);
    return;
  }
  const times = [history.started_at, history.stopped_at].filter((v): v is string => v !== null);
  await expect(container.locator("time")).toHaveCount(times.length);
  if (!times.length) {
    await expect(container.getByText("No worker lifecycle reports", { exact: true })).toBeVisible();
    await expect(container).not.toContainText("Start recorded");
    await expect(container).not.toContainText("Stop recorded");
  }
  for (const [label, at] of [["Start recorded", history.started_at], ["Stop recorded", history.stopped_at]] as const) {
    if (at) {
      await expect(container).toContainText(label);
      await expect(container.locator(`time[datetime="${at}"]`).first()).toBeVisible();
      await expect(container.locator(`time[datetime="${at}"]`).first()).toHaveAttribute("title", at);
    }
  }
}


test("visible sessions connect roster, exact detail and deep-link refresh", async ({ page, request }) => {
  const bootstrap = await (await request.get("/api/v1/bootstrap")).json();
  const watchEnabled = bootstrap.data.capabilities.some((c: { name: string; version: string; enabled: boolean }) => c.name === "terminal.watch" && c.version === "1" && c.enabled === true);
  const rosterRead = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/v1/sessions" && r.request().method() === "GET");
  await page.goto("/agents");
  const response = await rosterRead;
  expect(response.status()).toBe(200);
  const envelope = await response.json();
  expect(envelope.api_version).toBe("dashboard-read-1");
  const sessions: SessionRead[] = envelope.data.items;
  test.skip(sessions.length === 0, "No visible sessions in this installation");
  const roster = page.getByRole("list", { name: "Sessions" });
  await expect(roster).toBeVisible();
  for (const s of sessions) {
    const row = roster.locator(`li[data-session-id="${s.id}"]`);
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("data-state", s.observation.state);
    await expect(row).toContainText(`Central state: ${centralState(s.execution_authority)}`);
    await expectLifecycle(row, s);
  }
  const noReports = sessions.filter((s) => s.lifecycle && !s.lifecycle.started_at && !s.lifecycle.stopped_at).length;
  test.info().annotations.push({ type: "actual-api-lifecycle", description: `${sessions.length} rows checked; ${noReports} explicit no-reports rows` });
  const rosterImage = test.info().outputPath("sessions-desktop.png");
  await page.screenshot({ path: rosterImage, fullPage: true });
  await test.info().attach("sessions-desktop", { path: rosterImage, contentType: "image/png" });

  const session = sessions.find((s) => s.lifecycle && !s.lifecycle.started_at && !s.lifecycle.stopped_at) ?? sessions[0]!;
  const detailPath = `/api/v1/sessions/${encodeURIComponent(session.id)}`;
  const detailRead = page.waitForResponse((r) => new URL(r.url()).pathname === detailPath && r.request().method() === "GET");
  await roster.getByRole("link", { name: session.label, exact: true }).click();
  const detailResponse = await detailRead;
  expect(detailResponse.status()).toBe(200);
  const detailApi = (await detailResponse.json()).data as SessionRead;
  expect(detailApi.id).toBe(session.id);
  const detail = page.getByRole("region", { name: session.label, exact: true });
  await expect(page.getByRole("heading", { level: 2, name: session.label })).toBeVisible();
  await expect(detail.getByText("Central execution state", { exact: true }).locator("xpath=following-sibling::dd[1]")).toHaveText(centralState(detailApi.execution_authority));
  await expectLifecycle(detail, detailApi);
  if (detailApi.observation.state === "unknown") await expect(detail).toContainText("State unknown");
  if (detailApi.terminal && watchEnabled) {
    const tail = detail.getByRole("region", { name: "Read-only output tail" });
    await expect(tail).toBeVisible();
    await expect(tail.getByRole("status")).toHaveText("Not watching");
    await expect(tail.getByRole("button", { name: "Watch output for up to 15 seconds" })).toBeVisible();
    await expect(tail).toContainText("This is not a terminal screen or snapshot");
  } else await expect(detail.getByText("Terminal is not available", { exact: true })).toBeVisible();
  await expect(detail).toContainText("Recorded lifecycle reports are historical evidence");
  const detailImage = test.info().outputPath("session-detail-desktop.png");
  await page.screenshot({ path: detailImage, fullPage: true });
  await test.info().attach("session-detail-desktop", { path: detailImage, contentType: "image/png" });

  const reloadRead = page.waitForResponse((r) => new URL(r.url()).pathname === detailPath && r.request().method() === "GET");
  await page.reload();
  const refreshed = await reloadRead;
  expect(refreshed.status()).toBe(200);
  const refreshedApi = (await refreshed.json()).data as SessionRead;
  await expect(page.getByRole("heading", { level: 2, name: session.label })).toBeVisible();
  await expectLifecycle(detail, refreshedApi);
  await expect(detail.getByText("Central execution state", { exact: true }).locator("xpath=following-sibling::dd[1]")).toHaveText(centralState(refreshedApi.execution_authority));
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});

test("saved project bindings match the actual owner API without implying readiness", async ({ page, request }) => {
  const bootstrap = await (await request.get("/api/v1/bootstrap")).json();
  const capability = bootstrap.data.capabilities.find((c: { name: string }) => c.name === "projects.read");
  if (!capability?.enabled) {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Project execution bindings" })).toBeVisible();
    await expect(page.getByText(capability?.reason ?? "Not offered by this AQ server", { exact: true })).toBeVisible();
    return;
  }
  const response = page.waitForResponse(r => new URL(r.url()).pathname === "/api/projects" && r.request().method() === "GET");
  await page.goto("/settings");
  const result = await response;
  expect(result.status()).toBe(200);
  const actual = await result.json();
  const list = page.getByRole("list", { name: "Project execution bindings" });
  await expect(list.getByRole("listitem")).toHaveCount(actual.items.length);
  for (const row of actual.items) {
    const item = list.locator(`li[data-project-id="${row.binding.project_id}"]`);
    await expect(item).toContainText(row.binding.enabled ? "Configured enabled" : "Configured disabled");
    await expect(item).toContainText(`Revision ${row.revision}`);
    await expect(item).toContainText(row.binding.repository_id);
    await expect(item).toContainText(row.binding.graph_workspace_id);
    await expect(item).toContainText("Recorded external checks");
    for (const group of row.binding.allowed_worker_groups) await expect(item).toContainText(group);
    for (const profile of row.binding.allowed_agent_profiles) await expect(item).toContainText(profile);
    await item.getByText("Identifiers and check times", { exact: true }).click();
    await expect(item).toContainText(row.binding.catalog_digest);
    for (const node of row.binding.allowed_node_ids) await expect(item).toContainText(node);
    await expect(item.locator(`time[datetime="${new Date(row.validation.expires_at_ms).toISOString()}"]`)).toBeVisible();
  }
  test.info().annotations.push({ type: "actual-project-bindings", description: `${actual.items.length} first-page saved bindings checked; no current readiness assertion` });
  if (actual.items.length === 0) await expect(page.getByText("No project execution bindings configured.")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("project-bindings-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.screenshot({ path: test.info().outputPath("project-bindings-mobile.png"), fullPage: true });
});
