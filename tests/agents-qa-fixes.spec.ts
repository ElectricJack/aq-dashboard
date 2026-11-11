import { expect, test } from "@playwright/test";

// QA 2026-11-06 fixes on Agents (N-07, RA-13) against the labelled session and terminal fixtures.
// The last fixture terminal's policy has input turned off (src/mocks/terminal.ts).
for (const vp of [{ name: "desktop", width: 1440, height: 900, phone: false }, { name: "phone", width: 390, height: 844, phone: true }]) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("N-07: read-only terminal explains its policy and never offers control", async ({ page }) => {
      await page.goto("/agents/sessions");
      await expect(page).toHaveURL(/\/agents\/history$/);
      await page.getByRole("list", { name: "Session history" }).getByRole("button").last().click();
      await page.getByRole("link", { name: "Open session inspection" }).click();
      const pane = page.getByRole("region", { name: "Interactive agent terminal" });
      await expect(pane.getByText("This terminal does not accept input: its AQ terminal policy has input turned off.", {exact:true})).toBeVisible();
      await expect(pane).not.toHaveAttribute("data-controlling");
      // Control now connects automatically when allowed; a read-only terminal
      // exposes its policy reason and never offers an input/control action.
      await expect(pane.getByRole("button", {name:/take control/i})).toHaveCount(0);
      await expect(pane.getByRole("button", {name:"Type",exact:true})).toHaveCount(0);
      await expect(pane.getByRole("textbox", {name:/terminal input/})).toBeAttached();
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
