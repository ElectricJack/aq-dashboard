// KN-D (calm-vault-46.23): the Knowledge document shows a Sources / Linked work row under
// Verification, verification dates, ARIA tabs with count pills and the revision footer.
// Reference: docs/design/07-knowledge-v2.png. The mock knowledge record has no provenance or
// verification facts, so the "provenance" case injects a labelled [Fixture] through a fetch
// wrapper. Set KN_D_EVIDENCE=<dir> to save screenshots.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const project = "00000000-0000-0000-0000-000000000001";
const doc = "00000000-0000-0000-0000-000000000005";
const URL_PATH = `/knowledge/${doc}?scope=project:${project}`;
const EVIDENCE = process.env.KN_D_EVIDENCE;
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

// Contract-shaped (human-graph-1 Source oneOf) fixture facts, labelled as fixtures.
const FIXTURE = {
  verification: "verified",
  last_verified_by: "Fixture reviewer",
  last_verified_at: "2026-10-28T09:00:00Z",
  review_at: "2026-11-28T09:00:00Z",
  valid_until: "2027-01-31T00:00:00Z",
  provenance: [
    { source_id: "fixture-review", kind: "review", review_id: "fixture-execution-recovery-architecture", revision: 4, sha256: "a".repeat(64) },
    { source_id: "fixture-url", kind: "url", url: "https://example.org/fixture/recovery-qualification", observed_at: "2026-10-28T12:00:00Z", retained: true, artifact_id: null, sha256: null },
  ],
};

async function injectProvenance(page: Page) {
  await page.addInitScript(({ doc, fixture }) => {
    const wrap = (inner: typeof fetch): typeof fetch => async (input, init) => {
      const response = await inner(input, init);
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      if (!url.pathname.endsWith(`/knowledge/${doc}`) || !response.ok) return response;
      const body = await response.clone().json();
      body.data = { ...body.data, ...fixture };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    };
    let current = wrap(window.fetch.bind(window));
    Object.defineProperty(window, "fetch", { configurable: true, get: () => current, set: (value: typeof fetch) => { current = wrap(value); } });
  }, { doc, fixture: FIXTURE });
}

async function expectAxeClean(page: Page) {
  const results = await new AxeBuilder({ page }).include("#content")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("mock record: tabs, Sources / Linked work row and revision footer", async ({ page }) => {
      await page.goto(URL_PATH);
      const main = page.locator("#content");
      await expect(main.getByRole("heading", { name: "Fixture: execution ownership" })).toBeVisible();
      const tablist = main.getByRole("tablist", { name: "Document sections" });
      await expect(tablist.getByRole("tab", { name: /Sources/ })).toBeVisible();
      await expect(tablist.getByRole("tab", { name: "Content" })).toHaveAttribute("aria-selected", "true");
      await expect(main.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "doc-tab-content");
      await expect(main.getByRole("region", { name: /Sources \(0\)/ })).toContainText("No sources recorded for this revision.");
      const linked = main.getByRole("region", { name: /Linked work/ });
      await linked.scrollIntoViewIfNeeded();
      await expect(linked).toBeVisible();
      await expect(linked).toContainText("Linked work is not offered by this read contract.");
      await expect(main.getByText("Current revision 1 · Older revisions remain available")).toBeVisible();
      if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/knowledge-doc-mock-${vp.name}.png`, fullPage: true });
      await expectAxeClean(page);
    });

    test("fixture with provenance: typed source rows, verification dates, no raw JSON", async ({ page }) => {
      await injectProvenance(page);
      await page.goto(URL_PATH);
      const main = page.locator("#content");
      const sourcesTab = main.getByRole("tab", { name: /Sources/ });
      await expect(sourcesTab).toContainText("2");
      const verification = main.getByRole("region", { name: "Verification assertion" });
      await expect(verification).toContainText("Recorded by Fixture reviewer· Oct 28· applies to revision 1");
      await expect(verification).toContainText("Next review: Nov 28");
      await expect(verification).toContainText("Valid until Jan 31, 2027");

      const sources = main.getByRole("region", { name: /Sources \(2\)/ });
      const linked = main.getByRole("region", { name: /Linked work/ });
      await linked.scrollIntoViewIfNeeded();
      await expect(linked).toBeVisible();
      await expect(sources.getByText("Review revision")).toBeVisible();
      await expect(sources.getByText("Retained snapshot")).toBeVisible();
      await expect(sources.getByRole("link", { name: /example\.org\/fixture\/recovery-qualification/ })).toHaveAttribute("href", "https://example.org/fixture/recovery-qualification");
      await expect(sources.getByText(/"kind"/)).toHaveCount(2);
      for (const raw of await sources.getByText(/"kind"/).all()) await expect(raw).not.toBeVisible();
      await expect(main.getByText(/"kind"/).first()).not.toBeVisible();

      const s = (await sources.boundingBox())!, l = (await linked.boundingBox())!;
      if (vp.width >= 1200) {
        expect(Math.abs(s.y - l.y)).toBeLessThanOrEqual(4);
        expect(l.x).toBeGreaterThan(s.x + s.width - 1);
      } else {
        expect(l.y).toBeGreaterThanOrEqual(s.y + s.height - 1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      if (EVIDENCE) {
        await page.screenshot({ path: `${EVIDENCE}/knowledge-doc-fixture-${vp.name}.png`, fullPage: true });
        await main.locator("[role=tabpanel]").locator("xpath=..").screenshot({ path: `${EVIDENCE}/knowledge-doc-fixture-panel-${vp.name}.png` });
      }
      await expectAxeClean(page);

      // The Sources tab shows the same typed rows; Technical reference opens on demand.
      await sourcesTab.click();
      await expect(sourcesTab).toHaveAttribute("aria-selected", "true");
      const panel = main.getByRole("tabpanel", { name: /Sources/ });
      await panel.getByText("Technical reference").first().click();
      await expect(panel.locator("code").first()).toContainText('"kind":"review"');
      await sourcesTab.press("ArrowRight");
      await expect(main.getByRole("tab", { name: "History" })).toBeFocused();
      await expect(main.getByRole("tab", { name: /Relationships/ })).toHaveAttribute("aria-disabled", "true");
    });
  });
}

test.describe("phone tab overflow hint", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("overflowing tabs show a fade until scrolled to the end", async ({ page }) => {
    await page.goto(URL_PATH);
    const tablist = page.getByRole("tablist", { name: "Document sections" });
    await expect(tablist).toBeVisible();
    const wrap = tablist.locator("xpath=..");
    const overflows = await tablist.evaluate(e => e.scrollWidth > e.clientWidth);
    if (!overflows) return test.info().annotations.push({ type: "note", description: "tabs fit at 390px; no hint needed" });
    await expect(wrap).toHaveAttribute("data-more", "true");
    await tablist.evaluate(e => { e.scrollLeft = e.scrollWidth; });
    await expect(wrap).not.toHaveAttribute("data-more", /.*/);
    if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/knowledge-doc-tabs-scrolled-phone.png` });
  });
});
