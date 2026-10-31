import { queryKey, scopedKey } from "./queryKeys";

const ctx = { principalId: "u-1", authorizationRevision: "4", contractVersion: "proposed-0" };

test("keys differ by principal, authorization revision and contract version", () => {
  const base = queryKey(ctx, "tasks", {});
  expect(queryKey({ ...ctx, principalId: "u-2" }, "tasks", {})).not.toEqual(base);
  expect(queryKey({ ...ctx, authorizationRevision: "5" }, "tasks", {})).not.toEqual(base);
  expect(queryKey({ ...ctx, contractVersion: "1" }, "tasks", {})).not.toEqual(base);
});

test("all protected keys share a principal prefix for bulk clearing", () => {
  expect(queryKey(ctx, "tasks", {}).slice(0, 2)).toEqual(["aq", "u-1"]);
});

test("scoped keys carry the scope as a structural element", () => {
  const all = scopedKey(ctx, { kind: "all_authorized" }, "tasks", { readiness: "running" });
  const alpha = scopedKey(ctx, { kind: "project", project_id: "alpha" }, "tasks", { readiness: "running" });
  expect(all).not.toEqual(alpha);
  expect(alpha[5]).toEqual({ kind: "project", project_id: "alpha" });
  expect(alpha[4]).toBe("tasks");
});
