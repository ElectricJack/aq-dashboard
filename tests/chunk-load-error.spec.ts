import { expect, test } from "@playwright/test";

// Simulates a stale open tab: the app is loaded, then a lazy route chunk can no longer be fetched
// (dashboard rebuilt or server stopped). The raw router error page must never appear.
test("failing route chunk shows the in-app error state instead of the router error page", async ({ page, context }) => {
  // A reload just happened, so the loop guard must show the friendly state rather than reload again.
  await page.addInitScript(() => window.sessionStorage.setItem("aq-dashboard:chunk-reload-at", String(Date.now())));
  await page.goto("/overview");
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();

  await context.setOffline(true);
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Playbooks" }).click();

  const alert = page.getByRole("alert").filter({ hasText: "The dashboard was updated or the server is unreachable" });
  await expect(alert).toBeVisible();
  await expect(page.getByText("Unexpected Application Error")).toHaveCount(0);
  await expect(alert.getByRole("button", { name: "Reload" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await alert.getByText("Details").click();
  await expect(alert.locator("pre")).toContainText(/dynamically imported module|Unable to preload/);
});
