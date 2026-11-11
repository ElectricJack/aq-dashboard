import { expect, test } from "@playwright/test";

// Labelled mock fixtures, reviewed against docs/design/swarm-tree-v4.html.
for (const width of [320, 390, 1440]) {
  test(`status and Settings reflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.goto("/agents/swarm");
    const disclosure = page.getByRole("button", { name: /show details/i });
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await disclosure.click();
    await expect(page.getByRole("button", { name: /hide details/i })).toHaveAttribute("aria-expanded", "true");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.getByRole("link", { name: "Adjust limits" }).click();
    await expect(page).toHaveURL(/\/settings#swarm/);
    await expect(page.getByRole("button", { name: "Save limits" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}

test("disclosure persists and does not remount the tree or reset selection", async ({ page }) => {
  await page.goto("/agents/swarm?select=machine:desktop");
  const pane = page.getByRole("complementary", { name: "Properties" });
  await expect(pane).toContainText("desktop");
  const tree = page.getByRole("region", { name: "Swarm tree" });
  await tree.evaluate((element) => { (element as HTMLElement & { testMarker?: string }).testMarker = "same tree"; });
  await page.getByRole("button", { name: /show details/i }).click();
  await expect(page.getByRole("button", { name: /hide details/i })).toHaveAttribute("aria-expanded", "true");
  expect(await tree.evaluate((element) => (element as HTMLElement & { testMarker?: string }).testMarker)).toBe("same tree");
  await expect(pane).toContainText("desktop");
  await page.reload();
  await expect(page.getByRole("button", { name: /hide details/i })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: /hide details/i }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: /show details/i })).toHaveAttribute("aria-expanded", "false");
});

test("saved Normal and Reduced limits are reflected in Settings and the header", async ({ page }) => {
  await page.goto("/settings#swarm");
  const normal = page.getByRole("spinbutton", { name: "Normal fixture-provider Fixture standard limit" });
  const reduced = page.getByRole("spinbutton", { name: "Reduced usage fixture-provider Fixture standard limit" });
  await normal.fill("5");
  await reduced.fill("3");
  await page.getByRole("button", { name: "Save limits" }).click();
  await expect(page.getByText("Limits saved. Running agents continue.")).toBeVisible();
  await expect(normal).toHaveValue("5");
  await expect(reduced).toHaveValue("3");
  await page.getByRole("link", { name: "Back to Swarm" }).click();
  const mode = page.getByRole("switch", { name: "Reduced usage" });
  await expect(mode).not.toBeChecked();
  await mode.click();
  await expect(mode).toBeChecked();
  await page.getByRole("link", { name: "Adjust limits" }).click();
  await expect(page.getByText(/Reduced usage limits active/i)).toBeVisible();
  await expect(normal).toHaveValue("5");
  await expect(reduced).toHaveValue("3");
});

test("pending mode waits for server confirmation", async ({ page }) => {
  await page.goto("/agents/swarm?scenario=swarm-settings-pending");
  const mode = page.getByRole("switch", { name: "Reduced usage" });
  await expect(mode).toBeEnabled();
  await mode.click();
  await expect(mode).toBeDisabled();
  await expect(mode).not.toBeChecked();
  await expect(mode).toBeChecked({ timeout: 10_000 });
  await expect(mode).toBeEnabled();
});

for (const scenario of ["swarm-settings-conflict", "swarm-settings-error"]) {
  test(`${scenario} keeps unsaved edits visible`, async ({ page }) => {
    await page.goto(`/settings?scenario=${scenario}#swarm`);
    const normal = page.getByRole("spinbutton", { name: "Normal fixture-provider Fixture standard limit" });
    await normal.fill("5");
    await page.getByRole("button", { name: "Save limits" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(normal).toHaveValue("5");
  });
}

test("changing mode keeps the tree and selected machine", async ({ page }) => {
  await page.goto("/agents/swarm?select=machine:desktop");
  const tree = page.getByRole("region", { name: "Swarm tree" });
  const pane = page.getByRole("complementary", { name: "Properties" });
  await expect(pane).toContainText("desktop");
  await tree.evaluate(element => { (element as HTMLElement & { testMarker?: string }).testMarker = "same tree"; });
  const mode = page.getByRole("switch", { name: "Reduced usage" });
  await expect(mode).toBeEnabled();
  await mode.click();
  await expect(mode).toBeChecked();
  expect(await tree.evaluate(element => (element as HTMLElement & { testMarker?: string }).testMarker)).toBe("same tree");
  await expect(pane).toContainText("desktop");
});

test("mode conflict leaves the confirmed mode unchanged", async ({ page }) => {
  await page.goto("/agents/swarm?scenario=swarm-settings-conflict");
  const mode = page.getByRole("switch", { name: "Reduced usage" });
  await expect(mode).toBeEnabled();
  await mode.click();
  await expect(page.getByRole("alert").filter({ hasText: /mode update/i })).toBeVisible();
  await expect(mode).not.toBeChecked();
});

test("Reduced limits above Normal are rejected before saving", async ({ page }) => {
  await page.goto("/settings#swarm");
  const reduced = page.getByRole("spinbutton", { name: "Reduced usage fixture-provider Fixture standard limit" });
  await reduced.fill("5");
  await expect(reduced).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("button", { name: "Save limits" })).toBeDisabled();
  await expect(page.getByText("Reduced must be at or below Normal.")).toBeVisible();
});
