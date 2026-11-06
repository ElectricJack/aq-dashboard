import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

// AG-C: Details and Transcript open on demand over the focused workspace
// (right drawer on desktop, bottom sheet on phone) while the terminal stays
// mounted; Message is an honest unavailable slot. Labelled mock fixtures only.
// On phone a live terminal carries the reference 11 dock (AG-D): Terminal | Transcript
// switch over Take control · Message · More, with Session details under More. It replaces
// the Session actions row there, so the phone entry points are the dock's controls.
const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900, phone: false },
  { name: "phone-390", width: 390, height: 844, phone: true },
];
const SHOTS = process.env.FIXTURE_SHOTS;

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
}
async function withinViewport(page: Page, region: Locator) {
  const box = (await region.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 0.5);
  return box;
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("/agents/sess-07 opens Details and Transcript drawers over a mounted terminal", async ({ page }) => {
      await page.goto("/agents/sess-07");
      const terminal = page.getByRole("region", { name: "Interactive agent terminal" });
      await expect(terminal.locator(".xterm-rows")).toContainText("Fixture output for Worker 07");
      const actions = page.getByRole("group", { name: "Session actions" });
      const message = (vp.phone ? terminal : actions).getByRole("button", { name: "Message" });
      await expect(message).toBeDisabled();
      // The fixture server doesn't advertise session.message.enqueue, so Message states that reason (RA-14).
      if (vp.phone) await expect(message).toHaveAccessibleDescription("Not offered by this AQ server");
      else await expect(actions.getByText("Not offered by this AQ server")).toBeVisible();
      await noOverflow(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/after-focus-${vp.name}.png` });
      await axe(page);

      const more = terminal.getByRole("button", { name: "More terminal actions" });
      const detailsButton = vp.phone ? more : actions.getByRole("button", { name: "Session details" });
      await detailsButton.click();
      if (vp.phone) await terminal.getByRole("button", { name: "Session details" }).click();
      const details = page.getByRole("dialog", { name: "Session details" });
      await expect(details).toBeVisible();
      await expect(details.getByRole("navigation", { name: "Session operations" })).toBeVisible();
      await expect(details.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-current", "true");
      const box = await withinViewport(page, details);
      if (vp.width >= 768) {
        expect(box.width).toBeLessThanOrEqual(361);
        expect(box.x + box.width).toBeCloseTo(vp.width, 0);
      } else {
        expect(box.width).toBeCloseTo(vp.width, 0);
        expect(box.y + box.height).toBeCloseTo(vp.height, 0);
      }
      await noOverflow(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/after-details-${vp.name}.png` });
      await axe(page);
      await page.keyboard.press("Escape");
      await expect(details).toBeHidden();
      await expect(detailsButton).toBeFocused();

      const transcriptButton = vp.phone
        ? terminal.getByRole("radiogroup", { name: "Output view" }).getByRole("radio", { name: "Terminal" })
        : actions.getByRole("button", { name: "Transcript" });
      await (vp.phone ? terminal.getByRole("radio", { name: "Transcript" }) : transcriptButton).click();
      const transcript = page.getByRole("dialog", { name: "Transcript" });
      await expect(transcript).toBeVisible();
      await withinViewport(page, transcript);
      // Terminal stays attached and keeps its watch; the drawer reuses that output.
      await expect(terminal.locator(".xterm")).toBeAttached();
      await expect(transcript.getByRole("status").filter({ hasText: "Following the terminal's watch" })).toBeVisible();
      await expect(transcript.getByRole("button", { name: /Watch output for/ })).toHaveCount(0);
      await expect(transcript.getByLabel("Literal worker output")).toContainText("Tests: 1 failed, 20 passed, 21 total");
      await noOverflow(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/after-transcript-${vp.name}.png` });
      await axe(page);
      await transcript.getByRole("button", { name: "Close" }).click();
      await expect(transcript).toBeHidden();
      await expect(transcriptButton).toBeFocused();
      await expect(terminal.locator(".xterm-rows")).toContainText("Fixture output for Worker 07");
    });
  });
}
