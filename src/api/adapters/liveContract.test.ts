import bootstrap from "../../../contracts/live/fixtures/bootstrap.json";
import overview from "../../../contracts/live/fixtures/overview.json";
import projects from "../../../contracts/live/fixtures/projects.json";
import sessions from "../../../contracts/live/fixtures/sessions.json";
import session from "../../../contracts/live/fixtures/session.json";
import type { Bootstrap, Overview, Page, ProjectRef, SessionDetail, SessionSummary } from "../wire/proposed";
import { adaptBootstrap } from "./bootstrap";
import { adaptOverview, adaptPage, adaptSession, adaptSessionDetail } from "./inspection";

// Captured from actual AQ router responses over deliberately synthetic SQL
// owner fixtures. These prove consumer shape compatibility, not a live agent.
test("AQ bootstrap negotiates supported reads and disables unfinished capabilities", () => {
  expect(bootstrap.api_version).toBe("dashboard-read-1");
  const view = adaptBootstrap(bootstrap.data as Bootstrap);
  expect(view.capability("sessions.read").enabled).toBe(true);
  expect(view.capability("projects.read").enabled).toBe(true);
  expect(view.capability("tasks.read").enabled).toBe(false);
  expect(view.capability("provider.quota").enabled).toBe(false);
  expect(view.principal.authorizationRevision).toBe(bootstrap.data.principal.authorization_revision);
});

test("actual session projections preserve unknown process state and exact IDs", () => {
  const page = adaptPage(sessions.data as Page<SessionSummary>, (row) => adaptSession(row as SessionSummary, sessions.server_time));
  const detail = adaptSessionDetail(session.data as SessionDetail, session.server_time);
  expect(page.items).toHaveLength(1);
  expect(page.items[0]!.id).toBe(detail.id);
  expect(detail.observation.state).toBe("unknown");
  expect(detail.attemptId).toBe(session.data.attempt_id);
  expect(detail.profile.provider).toBe("fixture-a");
});

test("AQ overview does not turn unconnected domain facts into zero or no constraint", () => {
  const view = adaptOverview(overview.data as Overview);
  expect(view.counts.running).toEqual({ value: null, accuracy: "unknown" });
  expect(view.counts.needs_you).toEqual({ value: null, accuracy: "unknown" });
  expect(view.inMotion[0]!.nextConstraint?.explanation).toBe("Task constraints are not connected yet");
  const page = adaptPage(projects.data as Page<ProjectRef>, (row) => row);
  expect(page.items[0]!.label).toBe("Synthetic authority fixture");
});

// aq-server 09ee5e98 (dashboard-read `SessionDetail.ran_with`, spec 0014 §7.1): optional; `snapshot_digest` is null for an
// attempt recorded before roles. A session without the record, or with an incomplete one, shows none and still reads.
test("a session detail carries what its attempt ran with, when the server has that record", () => {
  const ran = { role: "developer", level: "standard-high", provider: "anthropic", model: "claude-opus-5-5", reasoning: "high", harness: "claude-code", execution_profile: "sandbox", snapshot_digest: null };
  const detail = (extra: Record<string, unknown>) => adaptSessionDetail({ ...session.data, ...extra } as SessionDetail, session.server_time);
  expect(detail({ ran_with: ran }).ranWith).toEqual({ role: "developer", level: "standard-high", provider: "anthropic", model: "claude-opus-5-5", reasoning: "high", harness: "claude-code" });
  expect(detail({}).ranWith).toBeNull();
  expect(detail({ ran_with: null }).ranWith).toBeNull();
  expect(detail({ ran_with: { ...ran, model: undefined } }).ranWith).toBeNull();
});
