import { expect, test, type Page } from "@playwright/test";

// RR-01 (QA 2026-11-06): a supplemental media listing the bundle cannot validate degrades only its card.
// Labelled results fixture with media on (src/mocks/results.ts, scenario results-media); the drift is
// injected in-page the way QA verified it, by adding an unknown key to the listing's `limits`.
async function driftMediaListing(page: Page) {
  await page.addInitScript(() => {
    const wrap = (inner: typeof fetch): typeof fetch => async (input, init) => {
      const response = await inner(input, init);
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      if (!/^\/api\/human\/results\/[^/]+\/revisions\/[^/]+\/media$/.test(url.pathname) || !response.ok) return response;
      const body = await response.clone().json();
      body.limits.max_future_limit = 1;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    };
    let current = wrap(window.fetch.bind(window));
    Object.defineProperty(window, "fetch", { configurable: true, get: () => current, set: (value: typeof fetch) => { current = wrap(value); } });
  });
}
const cards = (page: Page) => page.getByRole("list", { name: "Results feed" }).getByRole("article", { name: /^Result / });

for (const vp of [{ name: "desktop", width: 1440, height: 900 }, { name: "phone", width: 390, height: 844 }]) {
  test.describe(`${vp.name} ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("an empty media listing renders the neutral note", async ({ page }) => {
      await page.goto("/results?scenario=results-media");
      const card = cards(page).first();
      await expect(card).toBeVisible();
      await expect(card.getByText("No supplemental images are retained for this exact report.")).toBeVisible();
    });

    test("RR-01: a media listing contract failure stays in the card; the feed and shell keep working", async ({ page }) => {
      await driftMediaListing(page);
      await page.goto("/results?scenario=results-media");
      const card = cards(page).first();
      await expect(card.getByText("Supplemental images unavailable.")).toBeVisible();
      await expect(card.getByRole("button", { name: "Retry images" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Dashboard update required" })).toHaveCount(0);
      await expect(page.getByRole("tab", { name: "Latest" })).toBeVisible();
      expect(await cards(page).count()).toBeGreaterThan(1);
      await card.getByRole("button", { name: "Retry images" }).click();
      await expect(card.getByText("Supplemental images unavailable.")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Dashboard update required" })).toHaveCount(0);
    });

    test("RR-01: a result detail deep link keeps rendering when its media listing fails validation", async ({ page }) => {
      // Fixture result 31 (src/mocks/results.ts): report id(31), revision "1f" x 32.
      await driftMediaListing(page);
      await page.goto(`/results/00000000-0000-4000-8000-000000000031/revisions/${"1f".repeat(32)}?scenario=results-media`);
      await expect(page.getByText("Supplemental images unavailable.").first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "Dashboard update required" })).toHaveCount(0);
    });
  });
}
