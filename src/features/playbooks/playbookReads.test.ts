import { QueryClient } from "@tanstack/react-query";
import { ContractError } from "../../api/adapters/contract";
import { ApiError } from "../../api/client";
import { retryableReadFailure, retryUnlessMissing } from "./playbookReads";

const busy = new ApiError("http", "busy", { status: 429 }), missing = new ApiError("http", "missing", { status: 404 });
test("playbook reads follow the shared retry policy but report a missing run at once (ISSUE-001 integration)", () => {
  const shared = new QueryClient({ defaultOptions: { queries: { retry: (count: number) => count < 3 } } });
  expect(retryUnlessMissing(shared)(0, busy)).toBe(true); expect(retryUnlessMissing(shared)(3, busy)).toBe(false);
  expect(retryUnlessMissing(shared)(0, missing)).toBe(false);
  expect(retryUnlessMissing(new QueryClient({ defaultOptions: { queries: { retry: false } } }))(0, busy)).toBe(false);
  expect(retryUnlessMissing(new QueryClient())(2, busy)).toBe(true);
});
test("only read failures QueryStatus can retry are shared with the roster retry", () => {
  expect(retryableReadFailure(busy)).toBe(true); expect(retryableReadFailure(missing)).toBe(false);
  expect(retryableReadFailure(new ContractError("bad"))).toBe(false); expect(retryableReadFailure(new ApiError("http", "denied", { status: 403 }))).toBe(false);
});
