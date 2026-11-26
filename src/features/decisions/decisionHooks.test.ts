import { QueryClient } from "@tanstack/react-query";
import { refreshOverview } from "./decisionHooks";

test("a recorded decision invalidates only this principal's overview read", async () => {
  const client = new QueryClient();
  const mine = ["aq", "p1", 1, "v", "overview", { kind: "all_authorized" }];
  const other = ["aq", "p2", 1, "v", "overview", { kind: "all_authorized" }];
  const inbox = ["aq", "p1", 1, "v", "decision-inbox", {}];
  for (const key of [mine, other, inbox]) client.setQueryData(key, { ok: true });
  await refreshOverview(client, "p1");
  expect(client.getQueryState(mine)?.isInvalidated).toBe(true);
  expect(client.getQueryState(other)?.isInvalidated).toBe(false);
  expect(client.getQueryState(inbox)?.isInvalidated).toBe(false);
});
