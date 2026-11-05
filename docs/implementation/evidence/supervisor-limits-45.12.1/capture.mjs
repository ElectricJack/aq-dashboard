import { chromium } from "@playwright/test";
const [origin, out] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true }); const report = [];
for (const [name, width, height] of [["desktop-1440", 1440, 1000], ["phone-390", 390, 844]]) {
  const page = await browser.newPage({ viewport: { width, height } }); const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${origin}/supervisor`); await page.getByRole("textbox", { name: "Message the global supervisor" }).waitFor();
  await page.getByText("[Fixture] E0-shaped").first().waitFor();
  const gate = await page.getByText(/Dashboard update required/).count();
  const textOnly = await page.getByText(/Text only/).first().isVisible();
  const attach = await page.getByRole("button", { name: /attach|add context/i }).count();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  await page.screenshot({ path: `${out}/${name}.png` });
  report.push({ name, gate, textOnly, attach, overflow, errors });
}
console.log(JSON.stringify(report, null, 1)); await browser.close();
