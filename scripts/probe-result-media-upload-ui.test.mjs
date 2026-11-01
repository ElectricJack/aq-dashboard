import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
function rejected(overrides, pattern) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AQ_LIVE_")));
  const result = spawnSync(process.execPath, [new URL("./probe-result-media-upload-ui.mjs", import.meta.url).pathname], { env: { ...env, ...overrides }, encoding: "utf8", timeout: 10000 });
  assert.equal(result.error, undefined); assert.equal(result.status, 1); assert.match(result.stderr, pattern); assert.equal(result.stdout, "");
}
test("no default UI upload origin or implicit one-upload permission", () => rejected({}, /Required disposable fixture setting: AQ_LIVE_ALLOW_MEDIA_UI_UPLOAD/));
test("denied upload opt-in stops before browser/network", () => rejected({ AQ_LIVE_ALLOW_MEDIA_UI_UPLOAD: "0" }, /explicit disposable-fixture opt-in/));
test("remote URL is rejected even with explicit opt-in", () => rejected({ AQ_LIVE_ALLOW_MEDIA_UI_UPLOAD: "1", AQ_LIVE_URL: "https://example.com" }, /explicit loopback fixture origin/));
