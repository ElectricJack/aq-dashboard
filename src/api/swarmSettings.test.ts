import { setupServer } from "msw/node";
import { ContractError } from "./adapters/contract";
import { adaptSwarmSettings, inspectSwarmOperation, readSwarmSettings, saveSwarmSettings, setSwarmMode } from "./swarmSettings";
import { swarmSettingsHandlers } from "../mocks/swarmSettings";

const server = setupServer(...swarmSettingsHandlers());
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterAll(() => server.close());

const cell = { provider: "p", intelligence_class: "c", display_name: "Class", normal_limit: 2, reduced_limit: null, effective_limit: 2, running: null, waiting: null };
const wire = { revision: "1", catalog_revision: "2", active_mode: "normal", normal: [{ provider: "p", intelligence_class: "c", limit: 2 }], reduced: null, cells: [cell], unclassified: [] };
test("accepts unknown counts and validates every response field", () => {
  expect(adaptSwarmSettings(wire)).toEqual(wire);
  for (const bad of [
    { ...wire, unclassified: [{ provider: "old", running: -1, waiting: 0 }] },
    { ...wire, unclassified: [{ provider: "old", running: 1, waiting: 0 }, { provider: "old", running: 0, waiting: 1 }] },
    { ...wire, revision: "01" }, { ...wire, active_mode: "other" }, { ...wire, normal: [{ ...wire.normal[0], limit: -1 }] },
    { ...wire, cells: [{ ...cell, running: -1 }] }, { ...wire, cells: [{ ...cell, waiting: 1.5 }] },
    { ...wire, cells: [cell, cell] }, { ...wire, normal: [wire.normal[0], wire.normal[0]] },
    { ...wire, cells: [{ ...cell, effective_limit: undefined }] },
    { ...wire, active_mode: "reduced" },
    { ...wire, cells: [{ ...cell, normal_limit: 1 }] },
    { ...wire, cells: [{ ...cell, effective_limit: null }] },
    { ...wire, reduced: [{ ...wire.normal[0], limit: 3 }], cells: [{ ...cell, reduced_limit: 3 }] },
  ]) expect(() => adaptSwarmSettings(bad)).toThrow(ContractError);
});
test("accepts unclassified historical occupancy", () => {
  const historical = { ...wire, unclassified: [{ provider: "old", running: 1, waiting: 2 }] };
  expect(adaptSwarmSettings(historical)).toEqual(historical);
});
test("accepts catalog drift with retained removed pairs and new unconfigured cells", () => {
  const drifted = { ...wire, cells: [{ ...cell, provider: "new", normal_limit: null, effective_limit: null }] };
  expect(adaptSwarmSettings(drifted)).toEqual(drifted);
});
test("revision conflicts and exact operation replay preserve the confirmed snapshot", async () => {
  const initial = await readSwarmSettings();
  const save = { operation_id: "00000000-0000-4000-8000-000000000001", expected_revision: initial.revision, expected_catalog_revision: initial.catalog_revision, normal: initial.normal!, reduced: initial.reduced };
  const saved = await saveSwarmSettings(save);
  expect(saved.revision).not.toBe(initial.revision);
  expect(await saveSwarmSettings(save)).toEqual(saved);
  expect(await inspectSwarmOperation(save.operation_id)).toEqual(saved);
  await expect(saveSwarmSettings({ ...save, operation_id: "00000000-0000-4000-8000-000000000002" })).rejects.toMatchObject({ status: 409 });
  await expect(saveSwarmSettings({ ...save, expected_revision: saved.revision })).rejects.toMatchObject({ status: 409 });
  const mode = await setSwarmMode({ operation_id: "00000000-0000-4000-8000-000000000003", expected_revision: saved.revision, active_mode: "reduced" });
  expect(mode.active_mode).toBe("reduced");
  expect(mode.revision).not.toBe(saved.revision);
});
