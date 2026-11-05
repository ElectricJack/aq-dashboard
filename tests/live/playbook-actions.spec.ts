import { expect, test } from "@playwright/test";

// G9: each playbook control is enabled only by an advertised capability, otherwise disabled with its reason.
const CONTROLS = [
  { label: "Start run", capability: "playbooks.runs.start" },
  { label: "Cancel run", capability: "playbooks.runs.cancel" },
] as const;
type Capability = { name: string; enabled: boolean; reason?: string };

test("playbook action controls follow advertised capabilities", async ({ page, request }, testInfo) => {
  const bootstrap = await (await request.get("/api/v1/bootstrap")).json();
  const caps: Capability[] = bootstrap.data.capabilities;
  const find = (name: string) => caps.find(c => c.name === name);
  test.skip(find("playbooks.inspect")?.enabled !== true, "Actual configured playbook Driver and namespace-owner inspection are required");
  const runs = await (await request.get("/api/playbooks/inspection/runs?limit=25")).json();
  test.skip(runs.items.length === 0, "Actual configured namespace has no admitted run to inspect");
  const union = find("dashboard.actions");
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(`/playbooks/runs/${encodeURIComponent(runs.items[0].id)}`);
  await expect(page.getByRole("region", { name: `Run ${runs.items[0].id}` })).toBeVisible();
  for (const control of CONTROLS) {
    const button = page.getByRole("button", { name: new RegExp(`^${control.label}`) }).first();
    await expect(button).toBeVisible();
    const cap = union?.enabled ? find(control.capability) : union;
    if (!cap?.enabled) {
      await expect(button).toBeDisabled();
      // Absent kinds render the session's "not offered" reason; disabled ones carry the server's reason.
      await expect(button).toHaveAttribute("title", cap?.reason ? cap.reason : /.+/);
    }
  }
  await page.screenshot({ path: testInfo.outputPath("playbook-actions-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("playbook-actions-mobile.png"), fullPage: true });
  expect(errors).toEqual([]);
});
