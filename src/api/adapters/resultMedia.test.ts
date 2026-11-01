import { webcrypto } from "node:crypto";
import { vi } from "vitest";
import { adaptResultMedia, canonicalMedia } from "./resultMedia";
import { fixtureArtifact, fixtureHash, fixtureMedia, fixtureMediaBinding } from "../../test/resultMedia";
import { resultId } from "../../test/results";
beforeEach(() => vi.stubGlobal("crypto", webcrypto)); afterEach(() => vi.unstubAllGlobals());
test("uses the independent report binding and validates the exact canonical supplemental receipt", async () => {
  const page = fixtureMedia(); expect(await adaptResultMedia(page, fixtureMediaBinding())).toEqual(page);
  page.items[0]!.receipt.input.filename = "Changed human filename.png";
  await expect(adaptResultMedia(page, fixtureMediaBinding())).rejects.toThrow();
});
test.each(["coverage", "report_id", "report_revision", "project_id", "task_id", "attempt_id"] as const)("refuses foreign %s even if the media body agrees with itself", async field => {
  const binding = fixtureMediaBinding(); binding[field] = (field === "coverage" ? "all" : field === "report_revision" ? "c".repeat(64) : resultId(999)) as never;
  const raw = fixtureMedia([fixtureArtifact(1, binding)], binding);
  await expect(adaptResultMedia(raw, fixtureMediaBinding())).rejects.toThrow();
});
test("refuses foreign repository/object source and receipt bindings independently", async () => {
  for (const change of [(b: ReturnType<typeof fixtureMediaBinding>) => { b.source.repository_id = resultId(999); }, (b: ReturnType<typeof fixtureMediaBinding>) => { b.source.base.hex = "c".repeat(40); }]) {
    const binding = fixtureMediaBinding(); change(binding);
    await expect(adaptResultMedia(fixtureMedia([fixtureArtifact(1, binding)], binding), fixtureMediaBinding())).rejects.toThrow();
    await expect(adaptResultMedia(fixtureMedia([fixtureArtifact(1, binding)]), fixtureMediaBinding())).rejects.toThrow();
  }
});
test("retains tombstone provenance and enforces reason/time/current-policy bounds", async () => {
  const page = fixtureMedia(); const item = page.items[0]!;
  for (const availability of [
    { state: "missing", reason: "files_missing" }, { state: "withheld", reason: "owner_withheld" }, { state: "failed", reason: "integrity_failed" },
  ] as const) {
    item.availability = { ...availability, observed_at_ms: page.server_time_ms };
    expect((await adaptResultMedia(page, fixtureMediaBinding())).items[0]?.receipt.uploader_id).toBe(resultId(900));
  }
  item.availability = { state: "available", reason: null, observed_at_ms: page.server_time_ms }; page.limits.max_pixels = 1;
  await expect(adaptResultMedia(page, fixtureMediaBinding())).rejects.toThrow();
  item.availability = { state: "expired", reason: "retention_expired", observed_at_ms: page.server_time_ms };
  await expect(adaptResultMedia(page, fixtureMediaBinding())).rejects.toThrow();
});
test("checks closed fields, sorted unique artifacts, dimensions and unsafe values", async () => {
  const raw = fixtureMedia(); await expect(adaptResultMedia({ ...raw, url: "https://outside.test/image" }, fixtureMediaBinding())).rejects.toThrow();
  await expect(adaptResultMedia(fixtureMedia([fixtureArtifact(2), fixtureArtifact(1)]), fixtureMediaBinding())).rejects.toThrow();
  await expect(adaptResultMedia(fixtureMedia([fixtureArtifact(), fixtureArtifact()]), fixtureMediaBinding())).rejects.toThrow();
  raw.items[0]!.receipt.variants.preview.width = 1;
  raw.items[0]!.receipt_digest = fixtureHash(canonicalMedia(raw.items[0]!.receipt));
  await expect(adaptResultMedia(raw, fixtureMediaBinding())).rejects.toThrow();
  await expect(adaptResultMedia({ ...fixtureMedia(), server_time_ms: Number.MAX_SAFE_INTEGER + 1 }, fixtureMediaBinding())).rejects.toThrow();
});
