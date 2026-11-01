import { webcrypto } from "node:crypto";
import { vi } from "vitest";
import { adaptUploadStatus, freezeUpload, reselectUpload, validateUploadPng } from "./resultMediaUpload";
import { fixtureMediaBinding, fixturePng } from "../../test/resultMedia";
import { uploadActor, uploadFile, uploadFixture } from "../../test/resultMediaUpload";
import { resultId } from "../../test/results";
beforeEach(() => vi.stubGlobal("crypto", webcrypto)); afterEach(() => vi.unstubAllGlobals());
const expected = (status = uploadFixture()) => ({ binding: fixtureMediaBinding(), actor: uploadActor, operation: status.operation_id, requestDigest: status.request_digest });
test("freezes one literal body, exact bytes and null capture; original bytes reproduce the URL recipe", async () => {
  const frozen = await freezeUpload(uploadFile(), fixtureMediaBinding(), uploadActor);
  expect(JSON.parse(frozen.raw!)).toEqual({ operation_id: frozen.operation, input_digest: frozen.input.digest, input_bytes: frozen.bytes.length, filename: "Human example.png", capture: null });
  expect(await freezeUpload(uploadFile(), fixtureMediaBinding(), uploadActor, frozen)).toEqual(frozen);
  const status = uploadFixture("reserved", frozen); await expect(adaptUploadStatus(status, { ...expected(status), frozen })).resolves.toEqual(status);
  await expect(freezeUpload(uploadFile(fixturePng(99)), fixtureMediaBinding(), uploadActor, frozen)).rejects.toThrow();
});
test.each(["actor", "binding", "operation", "request", "deadline", "unknown-field", "terminal-write"])("rejects %s mismatch independently of the status's self-consistency", async fault => {
  const value = uploadFixture("retained"); const anchor = expected(value);
  if (fault === "actor") value.actor_id = resultId(901);
  if (fault === "binding") value.binding = { ...value.binding, task_id: resultId(999) };
  if (fault === "operation") value.operation_id = resultId(999);
  if (fault === "request") value.request_digest = `sha256:${"f".repeat(64)}`;
  if (fault === "deadline") value.upload_expires_at_ms = value.created_at_ms;
  if (fault === "unknown-field") Object.assign(value, { url: "https://example.com" });
  if (fault === "terminal-write") value.recovery.put_allowed = true;
  await expect(adaptUploadStatus(value, anchor)).rejects.toThrow();
});
test("retained artifact needs its exact receipt digest and original input", async () => {
  const value = uploadFixture("retained"); value.artifact!.receipt.input.filename = "Different.png";
  await expect(adaptUploadStatus(value, expected(value))).rejects.toThrow();
});
test("reselection can use another local name but preserves the authoritative original name and request hash", async () => {
  const status = uploadFixture("reserved"), frozen = await reselectUpload(uploadFile(fixturePng(), "Renamed locally.png"), status);
  expect(frozen.input.filename).toBe(status.input.filename); expect(JSON.parse(frozen.raw!).filename).toBe(status.input.filename);
  await expect(reselectUpload(uploadFile(fixturePng(99)), status)).rejects.toThrow();
});
test("foreign raw serialization is inspectable/resumable but cannot be invented for POST replay", async () => {
  const status = uploadFixture("received"); status.request_digest = `sha256:${"f".repeat(64)}`;
  await expect(adaptUploadStatus(status, expected(status))).resolves.toEqual(status);
  expect((await reselectUpload(uploadFile(), status)).raw).toBeNull();
});
test("rejects overlarge files before arrayBuffer and unsupported filenames before freezing", async () => {
  const file = uploadFile(), read = vi.fn(); Object.defineProperty(file, "size", { value: 1048577 }); Object.defineProperty(file, "arrayBuffer", { configurable: true, value: read });
  await expect(freezeUpload(file, fixtureMediaBinding(), uploadActor)).rejects.toThrow(); expect(read).not.toHaveBeenCalled();
  await expect(freezeUpload(uploadFile(undefined, "../secret.png"), fixtureMediaBinding(), uploadActor)).rejects.toThrow();
});
test("PNG preflight rejects CRC corruption and trailing data while retaining the strict static subset", () => {
  expect(() => validateUploadPng(fixturePng())).not.toThrow(); const bad = fixturePng(); bad[bad.length - 1] = 1;
  expect(() => validateUploadPng(bad)).toThrow(); expect(() => validateUploadPng(Uint8Array.from([...fixturePng(), 0]))).toThrow();
});
test("terminal observations cannot regress or replace an immutable retained receipt", async () => {
  const previous = uploadFixture("retained"), regressed = uploadFixture("reserved");
  await expect(adaptUploadStatus(regressed, { ...expected(previous), previous })).rejects.toThrow();
  const replaced = uploadFixture("retained"); replaced.artifact!.receipt_digest = `sha256:${"f".repeat(64)}`;
  await expect(adaptUploadStatus(replaced, { ...expected(previous), previous })).rejects.toThrow();
});
test("filename bound counts UTF8 bytes, accepts valid emoji and rejects isolated surrogates", async () => {
  await expect(freezeUpload(uploadFile(undefined, `${"😀".repeat(63)}.png`), fixtureMediaBinding(), uploadActor)).resolves.toBeDefined();
  await expect(freezeUpload(uploadFile(undefined, `${"😀".repeat(64)}.png`), fixtureMediaBinding(), uploadActor)).rejects.toThrow();
  const invalid = uploadFile(); Object.defineProperty(invalid, "name", { value: "bad\ud800.png" });
  await expect(freezeUpload(invalid, fixtureMediaBinding(), uploadActor)).rejects.toThrow();
});
