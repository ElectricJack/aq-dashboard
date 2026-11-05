// G11: tablet behaviour from 0002 §9 at 768 and 1024 (fixture contract).
// Compact rail with no phone navigation; Supervisor full page by default; Results comments in an
// overlay; one detail pane for Playbooks and Knowledge; one terminal for Agents.
import { expect, test } from "@playwright/test";
import { SURFACES, supervisorFixture } from "./pages";

const surface = (id: string) => SURFACES.find((s) => s.id === id)!;

for (const vp of [{ name: "tablet-1024", width: 1024, height: 768 }, { name: "tablet-768", width: 768, height: 1024 }] as const) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    const kind = { ...vp, kind: "tablet" } as const;

    test("shell keeps a compact labelled rail and no phone navigation", async ({ page }) => {
      await page.goto(surface("overview").path);
      await surface("overview").ready(page, kind);
      const rail = page.getByRole("complementary", { name: "Application navigation" });
      await expect(rail).toBeVisible();
      await expect(rail.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Results" })).toBeVisible();
      expect((await rail.boundingBox())!.width).toBeLessThanOrEqual(200);
      await expect(page.getByRole("navigation", { name: "Primary (compact)" })).toBeHidden();
    });

    test("supervisor opens as a full page, not a dock", async ({ page }) => {
      await supervisorFixture(page);
      await page.goto(surface("overview").path);
      await surface("overview").ready(page, kind);
      await expect(page.getByRole("button", { name: "Open supervisor" })).toHaveCount(0);
      await page.getByRole("complementary", { name: "Application navigation" }).getByRole("link", { name: "Supervisor" }).click();
      await expect(page).toHaveURL(/\/supervisor(\?|$)/);
      await expect(page.getByRole("heading", { level: 1, name: "Global supervisor" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toHaveCount(0);
    });

    test("results comments open as an overlay that restores focus", async ({ page }) => {
      await page.goto(surface("results").path);
      await surface("results").ready(page, kind);
      await expect(page.getByRole("complementary", { name: "Discussion" })).toHaveCount(0);
      const trigger = page.getByRole("list", { name: "Results feed" }).getByRole("button", { name: /^Comments \d/ }).first();
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Result comments" });
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    });

    test("playbooks shows one detail pane with a way back to the list", async ({ page }) => {
      await page.goto(surface("playbooks").path);
      await surface("playbooks").ready(page, kind);
      await expect(page.getByRole("list", { name: "Playbook runs" })).toBeHidden();
      await page.getByRole("link", { name: "All runs" }).click();
      await expect(page.getByRole("list", { name: "Playbook runs" })).toBeVisible();
    });

    test("knowledge shows one detail pane", async ({ page }) => {
      await page.goto(surface("knowledge").path);
      await surface("knowledge").ready(page, kind);
      await expect(page.getByRole("list", { name: "Knowledge records" })).toBeHidden();
    });

    test("agents focus shows one terminal", async ({ page }) => {
      await page.goto(surface("agents").path);
      await surface("agents").ready(page, kind);
      await expect(page.locator(".xterm")).toHaveCount(1);
    });
  });
}
