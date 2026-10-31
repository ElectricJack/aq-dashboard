import { queryKey } from "./queryKeys";

const ctx = { principalId: "u-1", authorizationRevision: "4", contractVersion: "proposed-0" };

test("keys differ by principal, authorization revision and contract version", () => {
  const base = queryKey(ctx, "tasks", { scope: { kind: "all_authorized" } });
  expect(queryKey({ ...ctx, principalId: "u-2" }, "tasks", {})).not.toEqual(base);
  expect(queryKey({ ...ctx, authorizationRevision: "5" }, "tasks", {})).not.toEqual(base);
  expect(queryKey({ ...ctx, contractVersion: "1" }, "tasks", {})).not.toEqual(base);
});

test("keys differ by scope", () => {
  expect(queryKey(ctx, "tasks", { scope: { kind: "all_authorized" } })).not.toEqual(
    queryKey(ctx, "tasks", { scope: { kind: "project", project_id: "p" } }),
  );
});

test("all protected keys share a principal prefix for bulk clearing", () => {
  expect(queryKey(ctx, "tasks", {}).slice(0, 2)).toEqual(["aq", "u-1"]);
});
