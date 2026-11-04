import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// PB-D (reference 06-playbooks.png): inspector header row, compact pin strip and Technical identity disclosure
// on labelled mock fixtures. Full digests stay in the DOM but are hidden until disclosed.
const evidence = "docs/evidence/playbooks-pb-d";
const waiting = "run-0000000000000284";
const fullArtifact = `sha256:a81c9e${"0".repeat(58)}`;
const VIEWPORTS = [
  { name: "d", width: 1440, height: 900 },
  { name: "m", width: 390, height: 844 },
];

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}
const noPageOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

for (const vp of VIEWPORTS) {
  test.describe(`${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("run header row, pin strip and Technical identity", async ({ page }) => {
      await page.goto("/playbooks");
      // A mouse click loads the route, so the programmatically focused H2 must not draw a ring.
      await page.getByRole("link", { name: new RegExp(`Worker recovery ${waiting}`) }).click({ timeout: 30_000 });
      const inspector = page.getByRole("region", { name: `Run ${waiting}` });
      const h2 = inspector.getByRole("heading", { level: 2, name: "worker-recovery" });
      await expect(h2).toBeFocused({ timeout: 30_000 });
      expect(await h2.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("none");

      const header = inspector.locator("header");
      await expect(header.getByText(/^run-284 · .+ · Started \d+m ago$/)).toBeVisible();
      await expect(header.getByTitle(waiting)).toHaveText("run-284");
      await expect(header.getByRole("button", { name: "Refresh run" })).toBeVisible();
      const chip = header.getByText("Waiting", { exact: true });
      const [h2Box, chipBox] = [(await h2.boundingBox())!, (await chip.boundingBox())!];
      if (vp.width === 1440) {
        expect(Math.abs(chipBox.y - h2Box.y)).toBeLessThanOrEqual(8);
        expect(chipBox.x).toBeGreaterThan(h2Box.x + h2Box.width);
      }

      const strip = inspector.getByText(/This run:\s*worker-recovery · a81c9e$/);
      await expect(strip).toBeVisible();
      await expect(inspector.getByText("Current step: Request review")).toBeVisible();

      const digest = inspector.getByText(fullArtifact, { exact: true }).first();
      await expect(digest).toBeAttached();
      await expect(digest).toBeHidden();
      expect(await noPageOverflow(page)).toBe(true);
      await expectNoAxeViolations(page);
      await page.screenshot({ path: `${evidence}/after-run-${vp.name}.png` });

      await inspector.getByText("Technical identity").click();
      await expect(digest).toBeVisible();
      await expect(inspector.getByText(`sha256:c4ec5a${"0".repeat(58)}`)).toBeVisible();
      expect(await noPageOverflow(page)).toBe(true);
      await expectNoAxeViolations(page);
      await digest.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${evidence}/after-run-identity-${vp.name}.png` });
    });

    test("definition rows and detail keep full digests under Technical identity", async ({ page }) => {
      await page.goto("/playbooks?view=definitions");
      const list = page.getByRole("list", { name: "Current playbook definitions" });
      const row = list.getByRole("button", { name: /^worker-recovery/ });
      await expect(row).toHaveText(/worker-recovery\s*1 entry\s*a81c9e$/, { timeout: 30_000 });
      await expect(row.getByTitle(fullArtifact)).toBeVisible();
      await row.click();

      const detail = page.getByRole("region", { name: "Definition worker-recovery" });
      const h2 = detail.getByRole("heading", { level: 2, name: "worker-recovery" });
      await expect(h2).toBeFocused();
      expect(await h2.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("none");
      const fingerprint = detail.getByText(`sha256:f1a9e2${"0".repeat(58)}`, { exact: true });
      await expect(fingerprint).toBeHidden();
      await expect(detail.getByText(fullArtifact, { exact: true })).toBeHidden();
      expect(await noPageOverflow(page)).toBe(true);
      await expectNoAxeViolations(page);
      await page.screenshot({ path: `${evidence}/after-definition-${vp.name}.png` });

      await detail.getByText("Technical identity").click();
      await expect(fingerprint).toBeVisible();
      await expect(detail.getByText(`sha256:50c3e7${"0".repeat(58)}`, { exact: true })).toBeVisible();
      await expect(detail.getByText(fullArtifact, { exact: true })).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });
}
