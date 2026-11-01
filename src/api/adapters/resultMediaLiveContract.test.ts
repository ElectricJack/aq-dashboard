import { webcrypto } from "node:crypto";
import { vi } from "vitest";
import example from "../../../contracts/live/result-media/example.json";
import { adaptResultMedia, resultMediaBinding } from "./resultMedia";
import { resultRecord } from "../../test/results";
test("consumes the frozen MediaCore example using independent API06 bridge fields", async () => {
  vi.stubGlobal("crypto", webcrypto);
  try {
    // The public fixture is synthetic contract data, not retained PNG-byte proof.
    const independent = { ...resultRecord(), report_id: "00000000-0000-0000-0000-000000000001", revision: "a".repeat(64), project_id: "00000000-0000-0000-0000-000000000002",
      task_id: "00000000-0000-0000-0000-000000000003", attempt_id: "00000000-0000-0000-0000-000000000004", repository_id: "00000000-0000-0000-0000-000000000005", source_base: { format: "sha1" as const, hex: "b".repeat(40) } };
    const page = await adaptResultMedia(example, resultMediaBinding(independent, "recorded_legacy_native_only"));
    expect(page.items[0]?.receipt_digest).toBe("sha256:a5ee1d5edd38a2db09e2de273e9fc263a73925b14ebebdbaf8e35731c5b1c3d7");
  } finally { vi.unstubAllGlobals(); }
});
