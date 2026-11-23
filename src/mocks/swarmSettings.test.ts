import { setupServer } from "msw/node";
import { ApiError } from "../api/client";
import { readSwarmSettings, updateSwarmLimits } from "../api/swarmSettings";
import { swarmSettingsHandlers } from "./swarmSettings";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterAll(() => server.close());

test("a rejected cell limit leaves its companion provider limit and revision untouched", async () => {
  server.use(...swarmSettingsHandlers());
  const before = await readSwarmSettings();
  const provider = before.cells[0]!.provider;
  const request = {
    operation_id: "e0000000-0000-4000-8000-0000000000b2",
    expected_revision: before.revision,
    provider: { provider, limit: 8 },
  };
  await expect(updateSwarmLimits({
    ...request,
    cell: { provider, intelligence_class: "unknown", limit: 2 },
  })).rejects.toBeInstanceOf(ApiError);
  expect(await readSwarmSettings()).toEqual(before);
  const saved = await updateSwarmLimits(request);
  expect(saved.provider_limits).toEqual([request.provider]);
  expect(await updateSwarmLimits(request)).toEqual(saved);
});
