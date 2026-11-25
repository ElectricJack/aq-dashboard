import { setupServer } from "msw/node";
import { apiGet, apiSend, ApiError } from "../api/client";
import { readSupervisors, setSupervisor } from "../api/supervisors";
import { adaptManualFleet } from "../features/agents/swarm/manualAgents";
import { supervisorHandlers } from "./supervisors";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test.each(["codex", "claude"])("the %s fixture control takes exactly a level and a candidate", async harness => {
  server.use(...supervisorHandlers("default"));
  expect(await readSupervisors()).toMatchObject({ supervisors: [], profiles: [{ harness: "codex" }, { harness: "claude" }, { harness: "codex" }, { harness: "claude" }] });
  server.use(...supervisorHandlers("supervisor-stopped"));
  const fleet = await readSupervisors();
  expect(fleet.supervisors[0]).toMatchObject({ enabled: false, profile: null });
  expect(adaptManualFleet(await apiGet("/api/manual-agents")).launch_profiles).toEqual(fleet.profiles);
  const { profile_id, candidate_id } = fleet.profiles.find(profile => profile.harness === harness)!, id = fleet.supervisors[0]!.id;
  const body = { operation_id: "e0000000-0000-4000-8000-0000000000b1", expected_revision: 0, enabled: true };
  // As the server does (deny_unknown_fields), the fixture refuses a selection with any other field.
  await expect(apiSend("POST", `/api/supervisors/${id}/control`, { ...body, intelligence_profile: { profile_id, profile_version: 1, candidate_id } })).rejects.toBeInstanceOf(ApiError);
  expect(await setSupervisor(id, { ...body, intelligence_profile: { profile_id, candidate_id } })).toMatchObject({ revision: 1, enabled: true, profile: { profile_id, candidate_id, harness } });
  expect((await readSupervisors()).supervisors[0]).toMatchObject({ enabled: true, revision: 1, profile: { profile_id, candidate_id, harness } });
});

test("the waiting scenario is an enabled supervisor with a reason, cleared by choosing a level", async () => {
  server.use(...supervisorHandlers("supervisor-waiting"));
  const fleet = await readSupervisors(), s = fleet.supervisors[0]!;
  expect(s).toMatchObject({ enabled: true, unavailable_reason: expect.stringContaining("choose a level") });
  const { profile_id, candidate_id } = fleet.profiles[0]!;
  await setSupervisor(s.id, { operation_id: "e0000000-0000-4000-8000-0000000000b2", expected_revision: s.revision, enabled: true, intelligence_profile: { profile_id, candidate_id } });
  expect((await readSupervisors()).supervisors[0]!.unavailable_reason).toBeUndefined();
});
