import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const script = new URL("./probe-result-media.mjs", import.meta.url);
function rejected(overrides, reason) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AQ_LIVE_")));
  const result = spawnSync(process.execPath, [script.pathname], { env: { ...env, ...overrides }, encoding: "utf8", timeout: 10000 });
  assert.equal(result.error, undefined); assert.equal(result.status, 1); assert.match(result.stderr, reason); assert.equal(result.stdout, "");
}
test("no default upload origin or implicit opt-in", () => rejected({}, /Required disposable fixture setting: AQ_LIVE_ALLOW_MEDIA_UPLOAD/));
test("a denied disposable opt-in stops before browser or network setup", () => rejected({ AQ_LIVE_ALLOW_MEDIA_UPLOAD: "0" }, /explicit disposable-fixture opt-in/));
test("an explicitly opted-in remote origin is rejected before other inputs or network setup", () => rejected({ AQ_LIVE_ALLOW_MEDIA_UPLOAD: "1", AQ_LIVE_URL: "https://example.com" }, /explicit loopback fixture origin/));
test("a local origin with URL credentials is rejected", () => rejected({ AQ_LIVE_ALLOW_MEDIA_UPLOAD: "1", AQ_LIVE_URL: "http://owner:secret@localhost:4211" }, /explicit loopback fixture origin/));
