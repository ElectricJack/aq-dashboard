import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { vi } from "vitest";
import example from "../../../contracts/live/result-media/example.json";
import { adaptResultMedia, canonicalMedia, isImageArtifact, resultMediaBinding } from "./resultMedia";
import { mediaBinding } from "./resultsFeedback";
import { ContractError } from "./contract";
import { resultRecord } from "../../test/results";
import { fixtureArtifact, fixtureClip, fixtureHash, fixtureMedia, fixtureMediaBinding } from "../../test/resultMedia";
beforeEach(() => vi.stubGlobal("crypto", webcrypto)); afterEach(() => vi.unstubAllGlobals());
const independent = () => resultMediaBinding({ ...resultRecord(), report_id: "00000000-0000-0000-0000-000000000001", revision: "a".repeat(64), project_id: "00000000-0000-0000-0000-000000000002",
  task_id: "00000000-0000-0000-0000-000000000003", attempt_id: "00000000-0000-0000-0000-000000000004", repository_id: "00000000-0000-0000-0000-000000000005", source_base: { format: "sha1" as const, hex: "b".repeat(40) } }, "recorded_legacy_native_only");
test("consumes the re-pinned MediaCore example (with X26 clip limits) using independent API06 bridge fields", async () => {
  // The public fixture is synthetic contract data, not retained PNG-byte proof.
  const page = await adaptResultMedia(example, independent());
  expect(page.items[0]?.receipt_digest).toBe("sha256:a5ee1d5edd38a2db09e2de273e9fc263a73925b14ebebdbaf8e35731c5b1c3d7");
  expect(page.limits.max_clip_bytes).toBe(4194304); expect(page.limits.max_clip_duration_ms).toBe(60000);
});
test("RR-01: the media listing captured from the live MS1 stack validates against the result it belongs to", async () => {
  const live = JSON.parse(readFileSync("src/test/fixtures/live-result-media-ms1.json", "utf8"));
  const feed = JSON.parse(readFileSync("src/test/fixtures/live-results-feed-ms1.json", "utf8"));
  const page = await adaptResultMedia(live, mediaBinding(feed.data.items[0]));
  expect(page.items).toEqual([]); expect(page.limits.max_clip_bytes).toBe(4194304);
  // Still closed: an unknown limits key, or an out-of-range clip limit, is refused.
  await expect(adaptResultMedia({ ...live, limits: { ...live.limits, max_future: 1 } }, mediaBinding(feed.data.items[0]))).rejects.toThrow(ContractError);
  await expect(adaptResultMedia({ ...live, limits: { ...live.limits, max_clip_duration_ms: 60001 } }, mediaBinding(feed.data.items[0]))).rejects.toThrow(ContractError);
});
test("pre-X26 servers that omit the clip limits still validate", async () => {
  const page = fixtureMedia(); expect(await adaptResultMedia(page, fixtureMediaBinding())).toEqual(page);
});
const clipArtifact = () => fixtureClip();
test("a video clip receipt is accepted and kept, but is not an image", async () => {
  const media = fixtureMedia([fixtureArtifact(1), clipArtifact()]); media.limits = { ...media.limits, max_clip_bytes: 4194304, max_clip_duration_ms: 60000 };
  const page = await adaptResultMedia(media, fixtureMediaBinding());
  expect(page.items.map(isImageArtifact)).toEqual([true, false]); expect(page.items[1]?.receipt.clip?.duration_ms).toBe(12_000);
  const bare = fixtureMedia([clipArtifact()]); // an available clip needs the server's clip limits
  await expect(adaptResultMedia(bare, fixtureMediaBinding())).rejects.toThrow(ContractError);
  const noClip = clipArtifact(); delete noClip.receipt.clip; noClip.receipt_digest = fixtureHash(canonicalMedia(noClip.receipt));
  await expect(adaptResultMedia({ ...media, items: [noClip] }, fixtureMediaBinding())).rejects.toThrow(ContractError);
  const imageWithClip = fixtureArtifact(1); imageWithClip.receipt.clip = { duration_ms: 1, poster_artifact_id: fixtureArtifact(2).receipt.artifact_id }; imageWithClip.receipt_digest = fixtureHash(canonicalMedia(imageWithClip.receipt));
  await expect(adaptResultMedia({ ...media, items: [imageWithClip] }, fixtureMediaBinding())).rejects.toThrow(ContractError);
});
