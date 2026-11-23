import { checkTerminalView, withinViewport } from "./support/terminal-view";
import { expect, test } from "@playwright/test";

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
      await checkTerminalView(page, `after-focus-${vp.name}`);

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
      await checkTerminalView(page, `after-details-${vp.name}`);
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
      await checkTerminalView(page, `after-transcript-${vp.name}`);
      await transcript.getByRole("button", { name: "Close" }).click();
      await expect(transcript).toBeHidden();
      await expect(transcriptButton).toBeFocused();
      await expect(terminal.locator(".xterm-rows")).toContainText("Fixture output for Worker 07");
    });
  });
}
