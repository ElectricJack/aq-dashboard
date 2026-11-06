import { expect, test } from "@playwright/test";

// QA 2026-11-06 fixes on Agents (N-07, RA-13) against the labelled session and terminal fixtures.
// The last fixture terminal's policy has input turned off (src/mocks/terminal.ts).
for (const vp of [{ name: "desktop", width: 1440, height: 900, phone: false }, { name: "phone", width: 390, height: 844, phone: true }]) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("N-07: a disabled Take control explains why and is not styled as the primary action", async ({ page }) => {
      await page.goto("/agents");
      const last = page.getByRole("list", { name: "Sessions" }).getByRole("listitem").last().getByRole("link").first();
      await last.click();
      const pane = page.getByRole("region", { name: "Interactive agent terminal" });
      await expect(pane.getByRole("status").filter({ hasText: "Watch only" })).toBeAttached();
      const take = pane.getByRole("button", { name: /take control/i });
      await expect(take).toBeDisabled();
      await expect(take).toHaveAccessibleDescription("This terminal does not accept input: its AQ terminal policy has input turned off.");
      await expect(pane.getByText("This terminal does not accept input: its AQ terminal policy has input turned off.")).toBeVisible();
      const fill = await take.evaluate((b) => getComputedStyle(b).backgroundColor);
      const accent = await page.evaluate(() => { const probe = document.createElement("span"); probe.style.color = "var(--color-accent)"; document.body.append(probe); const c = getComputedStyle(probe).color; probe.remove(); return c; });
      expect(fill).not.toBe(accent);
    });
  });
}

test.describe("desktop tabs", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test("RA-13: \"Open another session\" stays visible with several tabs open", async ({ page }) => {
    await page.goto("/agents/sess-07");
    const nav = page.getByRole("navigation", { name: "Session switcher" });
    for (let k = 1; k <= 5; k++) {
      await nav.getByRole("button", { name: "Open another session" }).click();
      await page.getByRole("listbox", { name: "Sessions" }).getByRole("option").nth(k).click();
      await expect(page.getByRole("listbox", { name: "Sessions" })).toBeHidden();
    }
    await expect(nav.locator("a[aria-label]")).toHaveCount(6);
    await expect(nav.getByRole("button", { name: "Open another session" })).toBeInViewport({ ratio: 1 });
  });
});
