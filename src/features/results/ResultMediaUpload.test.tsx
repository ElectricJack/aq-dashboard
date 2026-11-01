import { webcrypto } from "node:crypto";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";
import { resultPage, resultRecord } from "../../test/results";
import { uploadActor, uploadFile, uploadFixture, uploadReference } from "../../test/resultMediaUpload";
import { fixtureHash, fixtureMedia, fixtureMediaBinding, fixturePng } from "../../test/resultMedia";
import { resultMediaPath } from "../../api/resultMediaClient";
import type { FrozenUpload, UploadStatus } from "../../api/adapters/resultMediaUpload";
const binding = fixtureMediaBinding(), media = resultMediaPath(binding), report = media.slice(0, -6), exact = `/results/${binding.report_id}/revisions/${binding.report_revision}`;
const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("IntersectionObserver", undefined); });
afterEach(() => { server.resetHandlers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); }); afterAll(() => server.close());
function setup(options: { path?: string; enabled?: boolean; status?: UploadStatus; failCreate?: boolean } = {}) {
  const writes: { method: string; body: string | Uint8Array }[] = []; let intent: FrozenUpload | undefined, current = options.status, lookups = 0, listings = 0;
  server.use(
    http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, principal: { ...bootstrap.data.principal, id: uploadActor }, capabilities: [...bootstrap.data.capabilities.filter(c => !["results.read", "results.media.read", "results.media.upload"].includes(c.name)), { name: "results.read", version: "1", enabled: true }, { name: "results.media.read", version: "1", enabled: true }, { name: "results.media.upload", version: "1", enabled: options.enabled ?? true }] } })),
    http.get(report, () => HttpResponse.json(resultPage())), http.get("/api/human/results", () => HttpResponse.json(resultPage())),
    http.get(media, () => { listings++; return HttpResponse.json(fixtureMedia([])); }),
    http.post(`${media}-uploads`, async ({ request }) => {
      const raw = await request.text(); writes.push({ method: "POST", body: raw }); const body = JSON.parse(raw);
      expect(request.headers.get("X-AQ-Request")).toBe("1");
      intent = { operation: body.operation_id, actor: uploadActor, binding, input: { digest: body.input_digest, bytes: body.input_bytes, filename: body.filename }, requestDigest: fixtureHash(raw), raw, bytes: fixturePng() };
      current = uploadFixture("reserved", intent);
      return options.failCreate ? new HttpResponse(null, { status: 503 }) : HttpResponse.json(current, { status: 201 });
    }),
    http.get("/api/human/result-media-uploads/:operation", () => { lookups++; return current ? HttpResponse.json(current) : new HttpResponse(null, { status: 404 }); }),
    http.put("/api/human/result-media-uploads/:operation/content", async ({ request }) => { const bytes = new Uint8Array(await request.arrayBuffer()); writes.push({ method: "PUT", body: bytes }); expect(bytes).toEqual(fixturePng()); current = uploadFixture("received", intent); return HttpResponse.json(current); }),
    http.post("/api/human/result-media-uploads/:operation/finalize", async ({ request }) => { writes.push({ method: "FINALIZE", body: await request.text() }); current = uploadFixture("retained", intent); if (options.status && !intent) { current = { ...options.status, state: "retained", recovery: { put_allowed: false, finalize_allowed: false, reason: "already_retained" }, artifact: uploadFixture("retained").artifact }; } return HttpResponse.json(current); }),
  );
  const app = renderApp(options.path ?? exact);
  return { ...app, writes, lookups: () => lookups, listings: () => listings, current: () => current };
}
async function open() { await userEvent.click(await screen.findByRole("button", { name: "Add image" })); return screen.getByRole("dialog", { name: "Add supplemental PNG" }); }
function choose(file = uploadFile()) { fireEvent.change(screen.getByLabelText(/^PNG file/), { target: { files: [file] } }); }
test("upload capability absence preserves metadata; the new control exists only on exact report pages", async () => {
  const app = setup({ enabled: false }); await screen.findByText(resultRecord().conclusion); expect(screen.queryByRole("button", { name: "Add image" })).toBeNull(); expect(app.writes).toHaveLength(0);
  app.unmount(); const feed = setup({ path: "/results" }); await screen.findByText(resultRecord().conclusion); expect(screen.queryByRole("button", { name: "Add image" })).toBeNull(); expect(feed.writes).toHaveLength(0);
});
test("one explicit submit freezes raw intent, guards duplicate clicks and refreshes an already opened gallery", async () => {
  const app = setup(); const galleryButton = await screen.findByRole("button", { name: "View supplemental images" }); await userEvent.click(galleryButton); await screen.findByText("No supplemental images are retained for this exact report.");
  await open(); choose(); const button = screen.getByRole("button", { name: "Upload image" }); fireEvent.click(button); fireEvent.click(button);
  await screen.findByText("Image added to this report."); expect(app.writes.map(w => w.method)).toEqual(["POST", "PUT", "FINALIZE"]);
  expect(app.writes[2]!.body).toBe("{}"); const raw = app.writes[0]!.body as string, params = new URLSearchParams(app.router.state.location.search);
  expect(params.get("media_upload")).toBe(JSON.parse(raw).operation_id); expect(params.get("media_request")).toBe(fixtureHash(raw)); expect(params.get("media_actor")).toBe(uploadActor); expect(params.get("media_recipe")).toBe("1"); expect(params.toString()).not.toContain("Human");
  await waitFor(() => expect(app.listings()).toBe(2)); await userEvent.click(screen.getByRole("button", { name: "Close upload" })); await waitFor(() => expect(screen.getByRole("button", { name: "Upload details" })).toHaveFocus()); expect(app.writes).toHaveLength(3);
});
test("ambiguous admission stops the sequence, keeps reference across Close and pure lookup can recover it", async () => {
  const app = setup({ failCreate: true }); await open(); choose(); await userEvent.click(screen.getByRole("button", { name: "Upload image" }));
  await screen.findByText(/Upload outcome is unknown/); expect(app.writes.map(w => w.method)).toEqual(["POST"]); const search = app.router.state.location.search;
  await userEvent.click(screen.getByRole("button", { name: "Close upload" })); expect(app.router.state.location.search).toBe(search); await userEvent.click(screen.getByRole("button", { name: "Upload status" }));
  await userEvent.click(screen.getByRole("button", { name: "Check upload status" })); await screen.findByText("Upload reserved. The original PNG is still needed."); expect(app.lookups()).toBe(1); expect(app.writes).toHaveLength(1);
});
test("reload404 only offers exact admission replay after same recipe/file reproduction, never new UUID", async () => {
  const original = uploadFixture(), app = setup({ path: `${exact}?${uploadReference(original)}` });
  await screen.findByText(/No status is available yet/); expect(app.writes).toHaveLength(0); expect(screen.queryByRole("button", { name: "Replay original admission" })).toBeNull();
  fireEvent.change(screen.getByLabelText(/^Reselect original PNG/), { target: { files: [uploadFile(fixturePng(99))] } }); await screen.findByText(/does not reproduce the original upload/); expect(app.writes).toHaveLength(0);
  fireEvent.change(screen.getByLabelText(/^Reselect original PNG/), { target: { files: [uploadFile()] } }); const replay = await screen.findByRole("button", { name: "Replay original admission" }); await waitFor(() => expect(replay).toBeEnabled());
  await userEvent.click(replay); await screen.findByText("Image added to this report."); expect(JSON.parse(app.writes[0]!.body as string).operation_id).toBe(original.operation_id); expect(fixtureHash(app.writes[0]!.body as string)).toBe(original.request_digest);
});
test.each(["received", "finalizing"] as const)("reload %s can finalize from validated recovery flags without reselecting bytes", async state => {
  const original = uploadFixture(state); original.recovery.finalize_allowed = true; original.recovery.reason = null;
  const app = setup({ path: `${exact}?${uploadReference(original)}`, status: original });
  await screen.findByRole("button", { name: "Finalize upload" }); expect(app.writes).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: "Finalize upload" })); await screen.findByText("Image added to this report."); expect(app.writes.map(w => w.method)).toEqual(["FINALIZE"]);
});
test("finalizing busy permits lookup only; actor drift cannot inspect or mutate the referenced intent", async () => {
  const original = uploadFixture("finalizing"), app = setup({ path: `${exact}?${uploadReference(original)}`, status: original }); await screen.findByText(/Image processing is busy/);
  expect(screen.queryByRole("button", { name: "Finalize upload" })).toBeNull(); expect(screen.queryByLabelText(/^Reselect original PNG/)).toBeNull(); expect(app.writes).toHaveLength(0);
  const wrong = uploadReference({ ...original, actor_id: binding.task_id }); await act(() => app.router.navigate(`${exact}?${wrong}`)); await screen.findByText(/belongs to another account/); expect(screen.queryByRole("button", { name: "Check upload status" })).toBeNull(); expect(app.lookups()).toBe(1);
});
test.each([401, 403])("%s during upload fences all private state while bootstrap is offline", async status => {
  const app = setup(); await open(); choose(); server.use(http.post(`${media}-uploads`, () => new HttpResponse(null, { status })), http.get("/api/v1/bootstrap", () => new HttpResponse(null, { status: 503 })));
  await userEvent.click(screen.getByRole("button", { name: "Upload image" })); await screen.findByRole("heading", { name: status === 401 ? "Sign in required" : "Access denied" });
  await act(() => app.queryClient.invalidateQueries({ queryKey: ["bootstrap"] })); await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); expect(screen.queryByText("Human example.png")).toBeNull(); expect(screen.queryByText(resultRecord().conclusion)).toBeNull();
});
test("held preparation cannot create an intent after leaving the exact report", async () => {
  const app = setup(); await open(); let release!: () => void; const held = new Promise<ArrayBuffer>(resolve => { release = () => resolve(Uint8Array.from(fixturePng()).buffer); }); const file = uploadFile(); Object.defineProperty(file, "arrayBuffer", { value: () => held }); choose(file);
  await userEvent.click(screen.getByRole("button", { name: "Upload image" })); await act(() => app.router.navigate("/results")); await screen.findByText(resultRecord().conclusion);
  await act(async () => { release(); await held; }); expect(app.writes).toHaveLength(0); expect(app.router.state.location.search).toBe("");
});
test("unresolved reference cannot be silently reset; explicit acknowledgement removes only the reference", async () => {
  const app = setup({ path: `${exact}?${uploadReference()}` }); await screen.findByText(/No status is available yet/); const remove = screen.getByRole("button", { name: "Remove recovery reference" }); expect(remove).toBeDisabled();
  await userEvent.click(screen.getByRole("checkbox", { name: /previous upload may still complete/ })); await userEvent.click(remove); await screen.findByRole("button", { name: "Upload image" }); expect(app.router.state.location.search).toBe(""); expect(app.writes).toHaveLength(0);
});
test("reload reserved rejects changed bytes then resumes the original PNG using its retained filename", async () => {
  const original = uploadFixture(), app = setup({ path: `${exact}?${uploadReference(original)}`, status: original });
  await screen.findByText("Upload reserved. The original PNG is still needed.");
  fireEvent.change(screen.getByLabelText(/^Reselect original PNG/), { target: { files: [uploadFile(fixturePng(99))] } }); await screen.findByText(/does not reproduce the original upload/); expect(app.writes).toHaveLength(0);
  fireEvent.change(screen.getByLabelText(/^Reselect original PNG/), { target: { files: [uploadFile(fixturePng(), "Renamed locally.png")] } });
  const resume = await screen.findByRole("button", { name: "Resume original upload" }); await waitFor(() => expect(resume).toBeEnabled());
  await userEvent.click(resume); await screen.findByText("Image added to this report."); expect(app.writes.map(w => w.method)).toEqual(["PUT", "FINALIZE"]);
});
test("held preparation rejection cannot clear the busy state of a newer external operation lookup", async () => {
  const app = setup(); await open(); let reject!: (error: Error) => void, release!: () => void;
  const preparation = new Promise<ArrayBuffer>((_, rejectValue) => { reject = rejectValue; }), lookup = new Promise<void>(resolve => { release = resolve; });
  const file = uploadFile(); Object.defineProperty(file, "arrayBuffer", { value: () => preparation }); choose(file);
  await userEvent.click(screen.getByRole("button", { name: "Upload image" }));
  const original = uploadFixture(); let reads = 0;
  server.use(http.get("/api/human/result-media-uploads/:operation", async () => { reads++; await lookup; return HttpResponse.json(original); }));
  await act(() => app.router.navigate(`${exact}?${uploadReference(original)}`)); await waitFor(() => expect(reads).toBe(1));
  await act(async () => { reject(new Error("late preparation failure")); await preparation.catch(() => {}); });
  expect(screen.getByRole("button", { name: "Check upload status" })).toBeDisabled(); expect(screen.queryByText(/could not be prepared/)).toBeNull(); expect(app.writes).toHaveLength(0);
  await act(async () => { release(); await lookup; }); await screen.findByText("Upload reserved. The original PNG is still needed."); expect(screen.getByRole("button", { name: "Check upload status" })).toBeEnabled();
});
test("capability loss fences a held admission and drops file recovery while retaining pure status access", async () => {
  const app = setup(); await open(); choose(); let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; }); let entered = false;
  server.use(http.post(`${media}-uploads`, async ({ request }) => { const raw = await request.text(), body = JSON.parse(raw); entered = true; await held;
    return HttpResponse.json(uploadFixture("reserved", { operation: body.operation_id, actor: uploadActor, binding, input: { digest: body.input_digest, bytes: body.input_bytes, filename: body.filename }, requestDigest: fixtureHash(raw), raw, bytes: fixturePng() }), { status: 201 }); }));
  await userEvent.click(screen.getByRole("button", { name: "Upload image" })); await waitFor(() => expect(entered).toBe(true));
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, principal: { ...bootstrap.data.principal, id: uploadActor }, capabilities: [{ name: "results.read", version: "1", enabled: true }, { name: "results.media.read", version: "1", enabled: true }, { name: "results.media.upload", version: "1", enabled: false }] } })));
  await act(() => app.queryClient.invalidateQueries({ queryKey: ["bootstrap"] })); await screen.findByText("New uploads are unavailable. You can still inspect this upload.");
  await act(async () => { release(); await held; }); expect(screen.queryByRole("button", { name: "Replay original admission" })).toBeNull(); expect(screen.queryByLabelText(/^Reselect original PNG/)).toBeNull(); expect(screen.getByRole("button", { name: "Check upload status" })).toBeEnabled(); expect(app.writes).toHaveLength(0);
});
test("choosing an overlarge file clears an older unsubmitted candidate", async () => {
  const app = setup(); await open(); choose(); expect(screen.getByRole("button", { name: "Upload image" })).toBeEnabled();
  const invalid = uploadFile(); Object.defineProperty(invalid, "size", { value: 1048577 }); choose(invalid); await screen.findByText("Choose one PNG no larger than 1 MiB."); expect(screen.getByRole("button", { name: "Upload image" })).toBeDisabled(); expect(app.writes).toHaveLength(0);
});
test("a late admitted response after navigation cannot send PNG bytes or finalize the old report", async () => {
  const app = setup(); await open(); choose(); let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; }); let admissions = 0;
  server.use(http.post(`${media}-uploads`, async ({ request }) => { const raw = await request.text(), body = JSON.parse(raw); admissions++; await held; return HttpResponse.json(uploadFixture("reserved", { operation: body.operation_id, actor: uploadActor, binding, input: { digest: body.input_digest, bytes: body.input_bytes, filename: body.filename }, requestDigest: fixtureHash(raw), raw, bytes: fixturePng() }), { status: 201 }); }));
  await userEvent.click(screen.getByRole("button", { name: "Upload image" })); await waitFor(() => expect(admissions).toBe(1)); const saved = app.router.state.location.search; expect(saved).toContain("media_upload");
  await act(() => app.router.navigate("/results")); await screen.findByText(resultRecord().conclusion); await act(async () => { release(); await held; });
  expect(app.writes).toHaveLength(0); expect(screen.queryByRole("dialog")).toBeNull(); expect(screen.queryByRole("button", { name: "Upload image" })).toBeNull();
});
test("admission waits until a blocked recovery URL navigation actually commits", async () => {
  const app = setup(); await open(); choose(); app.router.getBlocker("hold-upload-reference", () => true);
  await userEvent.click(screen.getByRole("button", { name: "Upload image" }));
  await waitFor(() => expect(app.router.state.blockers.get("hold-upload-reference")?.state).toBe("blocked"));
  expect(app.router.state.location.search).toBe(""); expect(app.writes).toHaveLength(0);
  await act(() => app.router.state.blockers.get("hold-upload-reference")?.proceed?.());
  await screen.findByText("Image added to this report."); expect(app.writes.map(w => w.method)).toEqual(["POST", "PUT", "FINALIZE"]);
});
test.each(["missing", "reserved"] as const)("capability loss fences held %s file preparation and cannot resurrect bytes when re-enabled", async initial => {
  const original = uploadFixture(), app = setup({ path: `${exact}?${uploadReference(original)}`, status: initial === "reserved" ? original : undefined });
  if (initial === "reserved") await screen.findByText("Upload reserved. The original PNG is still needed."); else await screen.findByText(/No status is available yet/);
  let allowed = true, release!: () => void, reading = false; const held = new Promise<ArrayBuffer>(resolve => { release = () => resolve(Uint8Array.from(fixturePng()).buffer); });
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, principal: { ...bootstrap.data.principal, id: uploadActor }, capabilities: [{ name: "results.read", version: "1", enabled: true }, { name: "results.media.read", version: "1", enabled: true }, { name: "results.media.upload", version: "1", enabled: allowed }] } })));
  const file = uploadFile(); Object.defineProperty(file, "arrayBuffer", { value: () => { reading = true; return held; } });
  fireEvent.change(screen.getByLabelText(/^Reselect original PNG/), { target: { files: [file] } }); await waitFor(() => expect(reading).toBe(true));
  allowed = false; await act(() => app.queryClient.invalidateQueries({ queryKey: ["bootstrap"] })); await screen.findByText("New uploads are unavailable. You can still inspect this upload.");
  expect(screen.getByRole("button", { name: "Check upload status" })).toBeEnabled();
  await act(async () => { release(); await held; }); expect(screen.queryByText("Selected: Human example.png")).toBeNull(); expect(app.writes).toHaveLength(0);
  allowed = true; await act(() => app.queryClient.invalidateQueries({ queryKey: ["bootstrap"] })); await screen.findByLabelText(/^Reselect original PNG/);
  expect(screen.queryByRole("button", { name: "Replay original admission" })).toBeNull(); expect(screen.queryByRole("button", { name: "Resume original upload" })).toBeNull(); expect(screen.queryByText("Selected: Human example.png")).toBeNull(); expect(app.writes).toHaveLength(0);
});
test.each(["reserved", "received"] as const)("%s with typed expired recovery describes the last checked deadline without asking for input/finalization", async state => {
  const original = uploadFixture(state); original.recovery = { put_allowed: false, finalize_allowed: false, reason: "expired" };
  const app = setup({ path: `${exact}?${uploadReference(original)}`, status: original });
  await screen.findByText("Upload deadline expired at the last check. This upload cannot resume.");
  expect(screen.queryByText("Upload reserved. The original PNG is still needed.")).toBeNull(); expect(screen.queryByText("Original PNG received. Finalize it to add the image.")).toBeNull();
  expect(screen.queryByRole("button", { name: "Finalize upload" })).toBeNull(); expect(screen.queryByLabelText(/^Reselect original PNG/)).toBeNull(); expect(app.writes).toHaveLength(0);
});
test("initial held preparation is unmounted on capability loss and cannot publish a URL or revive a file", async () => {
  const app = setup(); await open(); let release!: () => void, reading = false, allowed = true;
  const held = new Promise<ArrayBuffer>(resolve => { release = () => resolve(Uint8Array.from(fixturePng()).buffer); }), file = uploadFile();
  Object.defineProperty(file, "arrayBuffer", { value: () => { reading = true; return held; } }); choose(file);
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, principal: { ...bootstrap.data.principal, id: uploadActor }, capabilities: [{ name: "results.read", version: "1", enabled: true }, { name: "results.media.read", version: "1", enabled: true }, { name: "results.media.upload", version: "1", enabled: allowed }] } })));
  await userEvent.click(screen.getByRole("button", { name: "Upload image" })); await waitFor(() => expect(reading).toBe(true));
  allowed = false; await act(() => app.queryClient.invalidateQueries({ queryKey: ["bootstrap"] })); await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await act(async () => { release(); await held; }); expect(app.router.state.location.search).toBe(""); expect(app.writes).toHaveLength(0);
  allowed = true; await act(() => app.queryClient.invalidateQueries({ queryKey: ["bootstrap"] })); await open(); expect(screen.getByRole("button", { name: "Upload image" })).toBeDisabled(); expect(screen.queryByText("Selected: Human example.png")).toBeNull(); expect(app.router.state.location.search).toBe("");
});
