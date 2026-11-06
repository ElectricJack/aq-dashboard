import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import valid from "../../../contracts/pinned/results-feedback/v1/fixtures/valid.json";
import invalid from "../../../contracts/pinned/results-feedback/v1/fixtures/invalid.json";
import replay from "../../../contracts/pinned/results-feedback/v1/fixtures/replay.json";
import compat from "../../../contracts/pinned/results-feedback/v1/fixtures/compatibility.json";
import operation from "../../../contracts/pinned/dashboard-actions/v1/fixtures/operation-confirmed.json";
import source from "../../../contracts/pinned/source.json";
import { adaptResultDetail, adaptResultsFeed, adaptResultOperation, validateResultPayload, viewScoped, ResultsViewError } from "./resultsFeedback";
import { ContractError } from "./contract";
import { isProtectedReadFailure } from "../client";

const detail = valid.find(f => f.type === "Detail")!.value;
const envelope = (data: unknown) => ({ ...compat.read, data, scope: {kind:"project" as const,project_id:"00000000-0000-4000-8000-000000000005"} });
test("pinned G6 valid, invalid, replay and compatibility cases", () => {
  // The dashboard deliberately does not author video-range comments yet (validateAnchor),
  // although the server schema admits them.
  const videoComment = (f: { type: string; value: unknown }) => f.type === "Comment" && (f.value as { anchor: { kind: string } }).anchor.kind === "video_range";
  for (const f of valid) {
    if (videoComment(f)) expect(() => validateResultPayload(f.type, f.value)).toThrow();
    else expect(() => validateResultPayload(f.type, f.value)).not.toThrow();
  }
  for (const f of invalid) expect(() => validateResultPayload(f.type, f.value), f.name).toThrow();
  expect(() => validateResultPayload("Comment", replay.original)).not.toThrow();
  expect(replay.original).toEqual(replay.identical);
  expect(replay.original).not.toEqual(replay.changed);
  expect(replay.changed.operation_id).toBe(replay.original.operation_id);
  expect(compat.read.api_version).toBe("dashboard-read-1");
  expect(() => validateResultPayload("Comment", compat.action.payload)).not.toThrow();
  for (const [file, digest] of Object.entries(source.sha256)) expect(createHash("sha256").update(readFileSync(`contracts/pinned/${file}`)).digest("hex")).toBe(digest);
});
test("Results feed rejects a foreign scope, changed assessment pin and duplicate page identities", () => {
  const page=envelope({items:[detail],next_cursor:null});
  expect(adaptResultsFeed(page,{kind:"project" as const,project_id:page.scope.project_id}).items).toHaveLength(1);
  expect(() => adaptResultsFeed(page,{kind:"all_authorized"})).toThrow();
  expect(() => adaptResultsFeed(envelope({items:[detail,detail]}),page.scope)).toThrow();
  expect(() => adaptResultDetail(envelope({...detail,assessment:{...(detail as {assessment:object}).assessment,result_revision:"b".repeat(64)}}),{id:"00000000-0000-4000-8000-000000000002",revision:"a".repeat(64)})).toThrow();
});
test("operation recovery requires the original identity and action profile", () => {
  expect(adaptResultOperation(operation, operation.data.operation_id).disposition).toBe("confirmed");
  expect(() => adaptResultOperation(operation, "00000000-0000-4000-8000-000000000009")).toThrow();
  expect(() => adaptResultOperation({...operation,api_version:"future"},operation.data.operation_id)).toThrow();
});

describe("additive Results feedback fields (results-feedback-1.1)", () => {
  test("a captured live MS1 feed validates against the re-pinned contract", () => {
    const live = JSON.parse(readFileSync("src/test/fixtures/live-results-feed-ms1.json", "utf8"));
    const page = adaptResultsFeed(live, { kind: "all_authorized" });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.some(i => "feedback_read_version" in i || "directly_following" in i.result)).toBe(true);
  });
  test("an unknown extra field still fails the strict adapter but only degrades the Results view", () => {
    const live = JSON.parse(readFileSync("src/test/fixtures/live-results-feed-ms1.json", "utf8"));
    live.data.items[0].result.future_field = true;
    expect(() => adaptResultsFeed(live, { kind: "all_authorized" })).toThrow(ContractError);
    let caught: unknown;
    try { viewScoped(() => adaptResultsFeed(live, { kind: "all_authorized" })); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(ResultsViewError);
    expect(caught).not.toBeInstanceOf(ContractError);
    expect(isProtectedReadFailure(caught)).toBe(false);
  });
});
