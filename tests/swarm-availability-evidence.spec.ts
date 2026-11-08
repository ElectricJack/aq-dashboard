import { expect, test } from "@playwright/test";

// D5 evidence: the owner availability control on the server pane in each state, from the labelled swarm fixture.
const evidence = "docs/evidence/swarm-p1";
const STATES = { on: "default", off: "swarm-availability-off", unset: "swarm-availability-unset" } as const;
const VIEWPORTS = [{ name: "1440", width: 1440, height: 900 }, { name: "390", width: 390, height: 844 }];

for (const vp of VIEWPORTS) for (const [name, scenario] of Object.entries(STATES)) {
  test(`availability ${name} at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`/agents?scenario=${scenario}`);
    await page.getByRole("button", { name: /^AQ server/ }).click();
    await expect(page.getByText("Owner availability", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: name === "on" ? "Turn off availability" : "Keep available" })).toBeVisible();
    await page.screenshot({ path: `${evidence}/availability-${name}-${vp.name}.png` });
  });
}
