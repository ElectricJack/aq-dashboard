import { createHash, webcrypto } from "node:crypto";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import rawDiscovery from "../../../contracts/live/supervisor-conversation/discovery.example.json";
import rawError from "../../../contracts/live/supervisor-conversation/attachment-error.example.json";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";
import { supervisorActor, supervisorDiscovery, supervisorHistory, supervisorMessage, supervisorActionReceipt } from "../../test/supervisor";
import { compareSupervisorCursors, type AttachmentDescriptor, type AttachmentUpload, type SupervisorMessage } from "../../api/adapters/supervisor";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("matchMedia", (query: string) => Object.assign(new EventTarget(), { matches: query === "(pointer: fine)", media: query, onchange: null, addListener() {}, removeListener() {} })); });
afterEach(() => { server.resetHandlers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
afterAll(() => server.close());
const discovery = { ...supervisorDiscovery, attachments: rawDiscovery.attachments };
const base = `/api/human/conversations/${discovery.conversation.id}`;
type Stored = { upload: AttachmentUpload; bytes: Uint8Array; contentType: string; csrf: string | null };
type Options = { attachments?: boolean; maxFiles?: number; history?: SupervisorMessage[]; putStatus?: (n: number) => { status: number; body: object } | null; deleteStatus?: number };
/** A small in-memory stand-in for the aq-server upload contract: raw typed bytes in, digest-pinned descriptors out, refs bound on send. */
function setup(options: Options = {}) {
  const staged = new Map<string, Stored>(), stored = [...(options.history ?? [])], posts: string[] = [], puts: { id: string; name: string | null; contentType: string; size: number; csrf: string | null }[] = [], deletes: string[] = [];
  let putCount = 0;
  const caps = options.attachments === false ? undefined : { ...rawDiscovery.attachments, ...(options.maxFiles ? { max_files_per_message: options.maxFiles } : {}) };
  const { attachments: _drop, ...plain } = discovery; void _drop;
  server.use(
    http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, global_supervisor: { status: "available", conversation_id: discovery.conversation.id }, principal: { ...bootstrap.data.principal, id: supervisorActor }, capabilities: [
      ...bootstrap.data.capabilities.filter(cap => !["supervisor.history.read", "supervisor.message.enqueue", "supervisor.conversation"].includes(cap.name)),
      { name: "dashboard.actions", version: "1", enabled: true }, { name: "supervisor.conversation", version: "1", enabled: true }, { name: "supervisor.history.read", version: "1", enabled: true }, { name: "supervisor.message.enqueue", version: "1", enabled: true },
    ] } })),
    http.get("/api/human/conversations/global", () => HttpResponse.json({ ...plain, ...(caps ? { attachments: caps, limits: { ...plain.limits, attachments: options.maxFiles ?? plain.limits.attachments } } : { limits: { ...plain.limits, attachments: 0 } }) })),
    http.get(`${base}/messages`, ({ request }) => {
      const url = new URL(request.url), before = url.searchParams.get("before"), after = url.searchParams.get("after");
      const items = stored.filter(item => (!before || compareSupervisorCursors(item.cursor, before) < 0) && (after === null || compareSupervisorCursors(item.cursor, after) > 0));
      return HttpResponse.json(supervisorHistory(items, { direction: after !== null ? "forward" : "backward", through_cursor: stored.at(-1)?.cursor.split(".")[0] ?? "0" }));
    }),
    http.put(`${base}/attachments/:id`, async ({ request, params }) => {
      const n = ++putCount, bytes = new Uint8Array(await request.arrayBuffer()), id = String(params.id), name = new URL(request.url).searchParams.get("name"), contentType = request.headers.get("content-type") ?? "";
      puts.push({ id, name, contentType, size: bytes.length, csrf: request.headers.get("x-aq-request") });
      const forced = options.putStatus?.(n); if (forced) return HttpResponse.json(forced.body, { status: forced.status });
      const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      const upload: AttachmentUpload = { id, name: name!, media_type: contentType as AttachmentUpload["media_type"], size_bytes: bytes.length, digest, conversation_id: discovery.conversation.id, created_at_ms: 1000000, state: "staged", message_id: null, expires_at_ms: 87400000 };
      staged.set(id, { upload, bytes, contentType, csrf: request.headers.get("x-aq-request") });
      return HttpResponse.json(upload, { status: 201 });
    }),
    http.delete(`${base}/attachments/:id`, ({ params }) => { deletes.push(String(params.id)); if (options.deleteStatus) return HttpResponse.json({ error: "attachment_bound", message: "bound" }, { status: options.deleteStatus }); staged.delete(String(params.id)); return new HttpResponse(null, { status: 204 }); }),
    http.post("/api/v1/actions", async ({ request }) => {
      const bytes = await request.text(); posts.push(bytes); const payload = JSON.parse(bytes).payload as { body: string; message_id: string; attachments: { id: string; digest: string }[] };
      if (!payload.attachments.every(ref => staged.get(ref.id)?.upload.digest === ref.digest)) return HttpResponse.json(supervisorActionReceipt(bytes, "rejected"), { status: 409 });
      const item = supervisorMessage(stored.length + 1, payload.body); item.message_id = payload.message_id;
      if (payload.attachments.length) (item as { attachments?: AttachmentDescriptor[] }).attachments = payload.attachments.map(ref => { const { id, name, media_type, size_bytes, digest } = staged.get(ref.id)!.upload; return { id, name, media_type, size_bytes, digest }; });
      stored.push(item); return HttpResponse.json(supervisorActionReceipt(bytes));
    }),
  );
  return { ...renderApp("/supervisor"), staged, stored, posts, puts, deletes };
}
const composer = () => screen.findByRole("textbox", { name: "Message the global supervisor" });
const chooser = async () => { await composer(); return screen.findByLabelText("Choose files to attach") as Promise<HTMLInputElement>; };
async function choose(...files: File[]) { const input = await chooser(); await waitFor(() => expect(input).toBeEnabled()); fireEvent.change(input, { target: { files } }); }
const file = (name: string, content: string | Uint8Array, type = "") => new File([content as BlobPart], name, { type });
const list = () => screen.getByRole("list", { name: "Attachments to send" });

test("without the attachments capability the composer stays text-only and offers no picker", async () => {
  setup({ attachments: false }); await composer();
  await waitFor(() => expect(screen.getAllByText(/Text only/).length).toBeGreaterThan(0));
  expect(screen.queryByLabelText("Choose files to attach")).toBeNull(); expect(screen.queryByRole("button", { name: /attach file/i })).toBeNull();
});

test.each([
  ["spec.pdf", "application/pdf", "%PDF-1.7 fixture"], ["spec.md", "text/markdown", "# Spec\n\nRequirements"], ["spec.txt", "text/plain", "Plain requirements"],
  ["spec.docx", DOCX, "PK\u0003\u0004 fixture"],
])("stages %s as raw bytes of %s with its file name and shows it before sending", async (name, mediaType, content) => {
  const app = setup(); await choose(file(name, content));
  const row = await within(await screen.findByRole("list", { name: "Attachments to send" })).findByText(name);
  await within(list()).findByText("Ready to send");
  expect(row).toBeInTheDocument();
  expect(app.puts).toHaveLength(1); expect(app.puts[0]).toMatchObject({ name, contentType: mediaType, size: content.length, csrf: "1" });
});

test("send binds the staged uploads as ordered id/digest refs, then history shows them on the right message after reload", async () => {
  const app = setup(); await choose(file("spec.md", "# Spec"), file("notes.txt", "Notes"));
  await waitFor(() => expect(within(list()).getAllByText("Ready to send")).toHaveLength(2));
  await userEvent.type(await composer(), "Review the attached spec");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText(/^Message queued\./);
  const payload = JSON.parse(app.posts[0]!).payload as { attachments: { id: string; digest: string }[] };
  const selected = ["spec.md", "notes.txt"].map(name => app.puts.find(put => put.name === name)!);
  expect(payload.attachments.map(ref => ref.id)).toEqual(selected.map(put => put.id));
  expect(payload.attachments.map(ref => ref.digest)).toEqual(selected.map(put => app.staged.get(put.id)!.upload.digest));
  const messages = await screen.findByRole("list", { name: "Supervisor messages" });
  const row = (await within(messages).findByText("Review the attached spec")).closest("li")!;
  expect(within(row).getByRole("list", { name: "Message attachments" })).toHaveTextContent("spec.md");
  expect(within(row).getByRole("list", { name: "Message attachments" })).toHaveTextContent("notes.txt");
  expect(screen.queryByRole("list", { name: "Attachments to send" })).toBeNull();
  // A fresh load of the same conversation reads the retained descriptors back.
  app.unmount();
  setup({ history: app.stored });
  const again = (await within(await screen.findByRole("list", { name: "Supervisor messages" })).findByText("Review the attached spec")).closest("li")!;
  expect(within(again).getByRole("list", { name: "Message attachments" })).toHaveTextContent("spec.mdMarkdown · 6 B");
});

test("a pending file can be removed before sending: the staged upload is deleted and omitted from the message", async () => {
  const app = setup(); await choose(file("spec.md", "# Spec"), file("draft.txt", "Draft"));
  await waitFor(() => expect(within(list()).getAllByText("Ready to send")).toHaveLength(2));
  await userEvent.click(screen.getByRole("button", { name: "Remove draft.txt" }));
  await waitFor(() => expect(within(list()).queryByText("draft.txt")).toBeNull());
  expect(app.deletes).toEqual([app.puts.find(put => put.name === "draft.txt")!.id]);
  await userEvent.type(await composer(), "Only the spec"); await userEvent.click(screen.getByRole("button", { name: "Send" })); await screen.findByText(/^Message queued\./);
  expect(JSON.parse(app.posts[0]!).payload.attachments.map((ref: { id: string }) => ref.id)).toEqual([app.puts.find(put => put.name === "spec.md")!.id]);
});

test("unsupported, empty, oversized and over-count files are named and never uploaded or silently dropped", async () => {
  const app = setup({ maxFiles: 1 });
  await choose(file("archive.zip", "zip", "application/zip"), file("empty.txt", ""), file("big.pdf", new Uint8Array(rawDiscovery.attachments.max_file_bytes + 1)));
  const rows = await within(await screen.findByRole("list", { name: "Attachments to send" })).findAllByRole("listitem");
  expect(rows).toHaveLength(3);
  expect(rows[0]).toHaveTextContent(/archive\.zip.*not supported/s); expect(rows[1]).toHaveTextContent(/empty\.txt.*empty/s); expect(rows[2]).toHaveTextContent(/big\.pdf.*limit is 1 MiB/s);
  expect(app.puts).toHaveLength(0);
  // A rejected file blocks sending (it would otherwise be omitted) until removed; it does not count toward the file limit.
  await userEvent.type(await composer(), "Review"); expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  expect(screen.getByText(/did not upload before sending/)).toBeInTheDocument();
  await choose(file("a.md", "# A"), file("b.md", "# B"));
  expect(await screen.findByText(/b\.md was not added: a message holds at most 1 file\./)).toBeInTheDocument();
  await waitFor(() => expect(app.puts).toHaveLength(1));
  for (const name of ["archive.zip", "empty.txt", "big.pdf"]) await userEvent.click(screen.getByRole("button", { name: `Remove ${name}` }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
});

test("a server refusal is shown with its reason; a transient failure can be retried with the same upload identity", async () => {
  const app = setup({ putStatus: n => n === 1 ? { status: 422, body: rawError } : n === 2 ? { status: 503, body: { error: "unavailable" } } : null });
  await choose(file("scan.pdf", "%PDF-1.7 image only"));
  const row = (await within(await screen.findByRole("list", { name: "Attachments to send" })).findByText("scan.pdf")).closest("li")!;
  await within(row).findByText(/no text can be extracted/); expect(within(row).queryByRole("button", { name: /Retry/ })).toBeNull();
  await userEvent.click(within(row).getByRole("button", { name: "Remove scan.pdf" })); expect(app.deletes).toHaveLength(0);
  await choose(file("flaky.md", "# Flaky"));
  const flaky = (await within(list()).findByText("flaky.md")).closest("li")!;
  await within(flaky).findByText(/could not store this file \(HTTP 503\)/);
  await userEvent.click(within(flaky).getByRole("button", { name: /Retry/ })); await within(flaky).findByText("Ready to send");
  expect(app.puts[2]!.id).toBe(app.puts[1]!.id);
});

test("an upload the signed-in account may not make is refused visibly", async () => {
  setup({ putStatus: () => ({ status: 403, body: { request_id: "r", code: "forbidden", message: "no", retryable: false } }) });
  await choose(file("spec.md", "# Spec"));
  await screen.findByText(/refused to store this file for your account/);
  expect(screen.getByRole("button", { name: "Remove spec.md" })).toBeEnabled();
});

test("sending waits for uploads to settle and a failed removal keeps the file visible", async () => {
  const app = setup({ deleteStatus: 409 }); await choose(file("spec.md", "# Spec"));
  await userEvent.type(await composer(), "Review");
  await within(list()).findByText("Ready to send");
  await userEvent.click(screen.getByRole("button", { name: "Remove spec.md" }));
  await screen.findByText(/Not removed: .*already part of a sent message/);
  expect(within(list()).getByText("spec.md")).toBeInTheDocument(); expect(app.deletes).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
});

test("a rejected send explains that expired files must be attached again", async () => {
  const app = setup(); await choose(file("spec.md", "# Spec")); await within(list()).findByText("Ready to send");
  app.staged.clear();
  await userEvent.type(await composer(), "Review"); await userEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText(/Not queued: the request was rejected\. If a file expired or was removed, remove it and attach it again\./);
});
