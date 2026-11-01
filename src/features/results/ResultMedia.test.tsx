import { webcrypto } from "node:crypto";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";
import { resultPage, resultRecord } from "../../test/results";
import { fixtureArtifact, fixtureMedia, fixtureMediaBinding, fixtureMediaHeaders, fixturePng } from "../../test/resultMedia";
import { resultMediaPath } from "../../api/resultMediaClient";
import type { MediaArtifact } from "../../api/adapters/resultMedia";
import { resultMediaBinding } from "../../api/adapters/resultMedia";
const server = setupServer(...handlersFor("default"));
let created: string[], revoked: string[];
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto); created = []; revoked = [];
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => { const url = `blob:verified-${created.length + 1}`; created.push(url); return url; });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(url => { revoked.push(url); });
});
afterEach(() => { server.resetHandlers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); }); afterAll(() => server.close());
const binding = fixtureMediaBinding(), base = resultMediaPath(binding);
function binary(artifact = fixtureArtifact(), bytes = fixturePng()) { return new HttpResponse(Uint8Array.from(bytes).buffer, { headers: fixtureMediaHeaders(artifact) }); }
function setup(items = [fixtureArtifact()], enabled = true) {
  let listings = 0; const reads: string[] = [];
  server.use(
    http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, capabilities: [...bootstrap.data.capabilities.filter(cap => !["results.read", "results.media.read"].includes(cap.name)), { name: "results.read", version: "1", enabled: true }, { name: "results.media.read", version: "1", enabled }] } })),
    http.get("/api/human/results", () => HttpResponse.json(resultPage())),
    http.get(base, () => { listings++; return HttpResponse.json(fixtureMedia(items)); }),
    http.get(`${base}/:artifact/content`, ({ request, params }) => { const variant = new URL(request.url).searchParams.get("variant")!; reads.push(variant); const artifact = items.find(item => item.receipt.artifact_id === params.artifact)!; return new HttpResponse(Uint8Array.from(fixturePng(Number(params.artifact?.toString().slice(-1)) === 2 ? 99 : 40)).buffer, { headers: fixtureMediaHeaders(artifact, variant as "preview" | "render") }); }),
  );
  return { ...renderApp("/results"), listings: () => listings, reads };
}
async function openImages() { await userEvent.click(await screen.findByRole("button", { name: "View supplemental images" })); return screen.findByRole("region", { name: "Human supplemental images" }); }
test("media capability absence preserves useful metadata and makes no media request", async () => {
  const app = setup(undefined, false); await screen.findByText("Retained worker claim 1");
  expect(screen.queryByRole("button", { name: "View supplemental images" })).toBeNull(); expect(app.listings()).toBe(0); expect(created).toHaveLength(0);
  await userEvent.click(screen.getByText("Report details and evidence references")); expect(screen.getByText("Source base")).toBeVisible();
});
test("only selected preview reads initially; expansion is explicit and close revokes its URL", async () => {
  const app = setup(); await screen.findByText("Retained worker claim 1"); expect(app.listings()).toBe(0);
  const gallery = await openImages(); await within(gallery).findByRole("img", { name: "Human supplemental Supplemental image 1.png" }); expect(app.reads).toEqual(["preview"]);
  expect(gallery).toHaveTextContent("Uploaded by a human. Capture details are unverified.");
  const expand = within(gallery).getByRole("button", { name: "Expand image" }); await userEvent.click(expand);
  const modal = screen.getByRole("dialog", { name: "Expanded supplemental image" }); await within(modal).findByRole("img"); expect(app.reads).toEqual(["preview", "render"]);
  const renderUrl = within(modal).getByRole("img").getAttribute("src")!;
  await userEvent.click(within(modal).getByRole("button", { name: "Close image" })); await waitFor(() => expect(revoked).toContain(renderUrl));
  expect(within(gallery).getByRole("img")).toBeVisible();
});
test("selector change revokes previous image and refuses a late old artifact response", async () => {
  const first = fixtureArtifact(), second = fixtureArtifact(2, binding, fixturePng(99));
  setup([first, second]); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let requests = 0;
  server.use(http.get(`${base}/${first.receipt.artifact_id}/content`, async () => { requests++; await gate; return binary(first); }));
  const gallery = await openImages(); await waitFor(() => expect(requests).toBe(1));
  await userEvent.click(within(gallery).getByRole("button", { name: "Supplemental image 2.png" }));
  await within(gallery).findByRole("img", { name: "Human supplemental Supplemental image 2.png" });
  await act(async () => { release(); await gate; });
  expect(within(gallery).getByRole("img")).toHaveAccessibleName("Human supplemental Supplemental image 2.png"); expect(created).toHaveLength(1);
});
test.each(["missing", "withheld", "failed"] as const)("%s provenance remains useful with no image bytes", async state => {
  const item = fixtureArtifact(); item.availability = { state, observed_at_ms: 1793518234000, reason: { missing: "files_missing", withheld: "owner_withheld", failed: "integrity_failed" }[state] as MediaArtifact["availability"]["reason"] };
  const app = setup([item]); const gallery = await openImages(); await within(gallery).findByText(/Image files are missing|Image withheld|Image verification/);
  expect(within(gallery).getByRole("button", { name: "Expand image" })).toBeDisabled(); expect(app.reads).toHaveLength(0); expect(created).toHaveLength(0);
  await userEvent.click(within(gallery).getByText("Image provenance")); expect(within(gallery).getByText(`Uploaded by ${item.receipt.uploader_id}`)).toBeVisible();
});
test.each([401, 403])("%s from render immediately removes all Blob URLs even with bootstrap offline", async status => {
  const app = setup(); const gallery = await openImages(); await within(gallery).findByRole("img");
  server.use(http.get(`${base}/:artifact/content`, () => new HttpResponse(null, { status })), http.get("/api/v1/bootstrap", () => new HttpResponse(null, { status: 503 })));
  await userEvent.click(within(gallery).getByRole("button", { name: "Expand image" }));
  await screen.findByRole("heading", { name: status === 401 ? "Sign in required" : "Access denied" });
  await act(() => app.queryClient.invalidateQueries({ queryKey: ["bootstrap"] }));
  expect(screen.queryByRole("img")).toBeNull(); expect(screen.queryByText("Retained worker claim 1")).toBeNull();
  expect(revoked).toEqual(expect.arrayContaining(created));
});
test("scope change revokes the old report image before another scope can render", async () => {
  const app = setup(); const gallery = await openImages(); const image = await within(gallery).findByRole("img"); const url = image.getAttribute("src")!;
  server.use(http.get("/api/human/results", () => HttpResponse.json(resultPage([]))));
  await act(() => app.router.navigate("/results?scope=project:other-project"));
  await screen.findByText("No recorded result reports in this scope."); expect(screen.queryByRole("img")).toBeNull(); expect(revoked).toContain(url);
});
test("a browser decode failure revokes the verified URL rather than keeping a broken image", async () => {
  setup(); const gallery = await openImages(); const image = await within(gallery).findByRole("img"); const url = image.getAttribute("src")!;
  fireEvent.error(image); await within(gallery).findByText("Image could not be displayed."); expect(revoked).toContain(url); expect(within(gallery).queryByRole("img")).toBeNull();
});
test("visible image window retains no more than two selected previews", async () => {
  setup(); const rows = [resultRecord(1), resultRecord(2), resultRecord(3)];
  server.use(http.get("/api/human/results", () => HttpResponse.json(resultPage(rows))));
  for (const [index, row] of rows.entries()) {
    const reportBinding = resultMediaBinding(row, "recorded_legacy_native_only"), artifact = fixtureArtifact(index + 1, reportBinding);
    server.use(http.get(resultMediaPath(reportBinding), () => HttpResponse.json(fixtureMedia([artifact], reportBinding))), http.get(`${resultMediaPath(reportBinding)}/:artifact/content`, () => binary(artifact)));
  }
  await screen.findByText("Retained worker claim 3");
  const cards = screen.getAllByRole("article");
  for (const card of cards) {
    await userEvent.click(within(card).getByRole("button", { name: "View supplemental images" })); await within(card).findByRole("img");
  }
  expect(screen.getAllByRole("img")).toHaveLength(2); expect(created.filter(url => !revoked.includes(url))).toHaveLength(2); expect(revoked).toHaveLength(1);
});
test("incorrect bytes never become a Blob URL", async () => {
  setup(); server.use(http.get(`${base}/:artifact/content`, () => binary(fixtureArtifact(), fixturePng(99))));
  await userEvent.click(await screen.findByRole("button", { name: "View supplemental images" }));
  await screen.findByRole("heading", { name: "Dashboard update required" }); expect(created).toHaveLength(0); expect(screen.queryByRole("img")).toBeNull();
});
test("an exact report/revision change fences a held response from the previous report", async () => {
  const app = setup(); let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; }); let oldReads = 0;
  server.use(http.get(`${base}/:artifact/content`, async () => { oldReads++; await held; return binary(); }));
  await openImages(); await waitFor(() => expect(oldReads).toBe(1));
  const row = { ...resultRecord(2), revision: "c".repeat(64) }, nextBinding = resultMediaBinding(row, "recorded_legacy_native_only"), nextArtifact = fixtureArtifact(2, nextBinding, fixturePng(99));
  server.use(http.get(`/api/human/results/${row.report_id}/revisions/${row.revision}`, () => HttpResponse.json(resultPage([row]))),
    http.get(resultMediaPath(nextBinding), () => HttpResponse.json(fixtureMedia([nextArtifact], nextBinding))),
    http.get(`${resultMediaPath(nextBinding)}/:artifact/content`, () => binary(nextArtifact, fixturePng(99))));
  await act(() => app.router.navigate(`/results/${row.report_id}/revisions/${row.revision}`));
  const nextGallery = await openImages(); await within(nextGallery).findByRole("img", { name: "Human supplemental Supplemental image 2.png" });
  await act(async () => { release(); await held; });
  expect(screen.getAllByRole("img")).toHaveLength(1); expect(created).toHaveLength(1);
  expect(screen.queryByText("Retained worker claim 1")).toBeNull();
});
test.each(["removed", "revised"])("same-feed refresh %s report immediately closes and revokes an expanded image", async state => {
  const app = setup(); const gallery = await openImages(); await within(gallery).findByRole("img");
  await userEvent.click(within(gallery).getByRole("button", { name: "Expand image" }));
  const modal = screen.getByRole("dialog", { name: "Expanded supplemental image" }); const render = await within(modal).findByRole("img"); const renderUrl = render.getAttribute("src")!;
  server.use(http.get("/api/human/results", () => HttpResponse.json(resultPage(state === "removed" ? [] : [{ ...resultRecord(), revision: "c".repeat(64) }]))));
  await act(() => app.queryClient.invalidateQueries({ predicate: query => query.queryKey[4] === "result-metadata" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Expanded supplemental image" })).toBeNull());
  expect(revoked).toContain(renderUrl); expect(screen.queryByRole("img")).toBeNull();
});
test.each(["missing", "withheld"] as const)("an observed %s artifact closes the expanded stale selection", async state => {
  const app = setup(); const gallery = await openImages(); await within(gallery).findByRole("img");
  await userEvent.click(within(gallery).getByRole("button", { name: "Expand image" }));
  const modal = screen.getByRole("dialog", { name: "Expanded supplemental image" }); const render = await within(modal).findByRole("img"); const renderUrl = render.getAttribute("src")!;
  const item = fixtureArtifact(); item.availability = { state, observed_at_ms: 1793518234000, reason: state === "missing" ? "files_missing" : "owner_withheld" };
  server.use(http.get(base, () => HttpResponse.json(fixtureMedia([item]))));
  await act(() => app.queryClient.invalidateQueries({ predicate: query => query.queryKey[4] === "result-media-list" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Expanded supplemental image" })).toBeNull());
  expect(revoked).toContain(renderUrl); expect(screen.queryByRole("img")).toBeNull();
});
