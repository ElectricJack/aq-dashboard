import { describe, expect, it } from "vitest";
import { subjectPath } from "./subjects";

describe("subjectPath", () => {
  it("links result digests to the bare-hex results revision route", () => {
    const hex = "3f1aa742fd8f2b44648270360250f7789e1181ff7bf9191b75302b8d810364b9";
    expect(subjectPath({ type: "result", id: "f9ccb524-8339-40ea-bbc4-0d64d3e23667", revision: `sha256:${hex}` }))
      .toBe(`/results/f9ccb524-8339-40ea-bbc4-0d64d3e23667/revisions/${hex}`);
  });
  it("opens an internal run in History with the Internal filter on", () => {
    expect(subjectPath({ type: "internal_run", id: "0b3c2d4e-5f60-4718-8a9b-c0d1e2f3a4b5" })).toBe("/agents/history?internal=1");
  });
});

it("labels a successful process outcome for every surface (SO-04)", async () => {
  const { FACT_LABEL } = await import("./subjects");
  expect(FACT_LABEL.process_success).toBe("Process succeeded");
});
