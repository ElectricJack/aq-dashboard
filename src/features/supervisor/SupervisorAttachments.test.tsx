import { webcrypto } from "node:crypto";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { setupServer } from "msw/node";
import rawDiscovery from "../../../contracts/live/supervisor-conversation/discovery.example.json";
import rawError from "../../../contracts/live/supervisor-conversation/attachment-error.example.json";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";

import { attachmentFixture } from "../../test/supervisorAttachments";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("matchMedia", (query: string) => Object.assign(new EventTarget(), { matches: query === "(pointer: fine)", media: query, onchange: null, addListener() {}, removeListener() {} })); });
afterEach(() => { server.resetHandlers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
afterAll(() => server.close());
function setup(options?: Parameters<typeof attachmentFixture>[1]) {
  const store = attachmentFixture(server, options);
  return { ...renderApp("/supervisor"), ...store };
}
const composer = () => screen.findByRole("textbox", { name: "Message the global supervisor" });
const chooser = async () => { await composer(); return screen.findByLabelText("Choose files to attach") as Promise<HTMLInputElement>; };
async function choose(...files: File[]) { const input = await chooser(); await waitFor(() => expect(input).toBeEnabled()); fireEvent.change(input, { target: { files } }); }
function file(name: string, content: string | Uint8Array, type = "") {
  return new File([content as BlobPart], name, { type });
}

const chooseFile = (name: string, content: string) => choose(file(name, content));
function chooseTextFiles(files: Record<string, string>) {
  return choose(...Object.entries(files).map(([name, text]) => file(name, text)));
}

const list = () => screen.getByRole("list", { name: "Attachments to send" });

async function queuedAttachments() {
  return within(await screen.findByRole("list", { name: "Attachments to send" }));
}

function readyFiles(count: number) {
  return waitFor(() => expect(within(list()).getAllByText("Ready to send")).toHaveLength(count));
}

async function sentMessage(text: string) {
  const messages = await screen.findByRole("list", { name: "Supervisor messages" });
  return (await within(messages).findByText(text)).closest("li")!;
}

async function sendText(text: string) {
  await userEvent.type(await composer(), text);
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
}

test("without the attachments capability the composer stays text-only and offers no picker", async () => {
  setup({ attachments: false }); await composer();
  await waitFor(() => expect(screen.getAllByText(/Text only/).length).toBeGreaterThan(0));
  expect(screen.queryByLabelText("Choose files to attach")).toBeNull(); expect(screen.queryByRole("button", { name: /attach file/i })).toBeNull();
});

test.each([
  ["spec.pdf", "application/pdf", "%PDF-1.7 fixture"], ["spec.md", "text/markdown", "# Spec\n\nRequirements"], ["spec.txt", "text/plain", "Plain requirements"],
  ["spec.docx", DOCX, "PK\u0003\u0004 fixture"],
])("stages %s as raw bytes of %s with its file name and shows it before sending", async (name, mediaType, content) => {
  const app = setup(); await chooseFile(name, content);
  const row = await (await queuedAttachments()).findByText(name);
  await within(list()).findByText("Ready to send");
  expect(row).toBeInTheDocument();
  expect(app.puts).toHaveLength(1); expect(app.puts[0]).toMatchObject({ name, contentType: mediaType, size: content.length, csrf: "1" });
});

test("send binds the staged uploads as ordered id/digest refs, then history shows them on the right message after reload", async () => {
  const app = setup(); await chooseTextFiles({ "spec.md": "# Spec", "notes.txt": "Notes" });
  await readyFiles(2);
  await sendText("Review the attached spec");
  await screen.findByText(/^Message queued\./);
  const payload = JSON.parse(app.posts[0]!).payload as { attachments: { id: string; digest: string }[] };
  const selected = ["spec.md", "notes.txt"].map(name => app.puts.find(put => put.name === name)!);
  expect(payload.attachments.map(ref => ref.id)).toEqual(selected.map(put => put.id));
  expect(payload.attachments.map(ref => ref.digest)).toEqual(selected.map(put => app.staged.get(put.id)!.upload.digest));
  const row = await sentMessage("Review the attached spec");
  const attachments = within(row).getByRole("list", { name: "Message attachments" });
  expect(attachments).toHaveTextContent("spec.md");
  expect(attachments).toHaveTextContent("notes.txt");
  expect(screen.queryByRole("list", { name: "Attachments to send" })).toBeNull();
  // A fresh load of the same conversation reads the retained descriptors back.
  app.unmount();
  setup({ history: app.stored });
  const again = await sentMessage("Review the attached spec");
  expect(within(again).getByRole("list", { name: "Message attachments" })).toHaveTextContent("spec.mdMarkdown · 6 B");
});

test("a pending file can be removed before sending: the staged upload is deleted and omitted from the message", async () => {
  const app = setup(); await chooseTextFiles({ "spec.md": "# Spec", "draft.txt": "Draft" });
  await readyFiles(2);
  await userEvent.click(screen.getByRole("button", { name: "Remove draft.txt" }));
  await waitFor(() => expect(within(list()).queryByText("draft.txt")).toBeNull());
  expect(app.deletes).toEqual([app.puts.find(put => put.name === "draft.txt")!.id]);
  await sendText("Only the spec"); await screen.findByText(/^Message queued\./);
  expect(JSON.parse(app.posts[0]!).payload.attachments.map((ref: { id: string }) => ref.id)).toEqual([app.puts.find(put => put.name === "spec.md")!.id]);
});

test("unsupported, empty, oversized and over-count files are named and never uploaded or silently dropped", async () => {
  const app = setup({ maxFiles: 1 });
  await choose(file("archive.zip", "zip", "application/zip"), file("empty.txt", ""), file("big.pdf", new Uint8Array(rawDiscovery.attachments.max_file_bytes + 1)));
  const rejected = await (await queuedAttachments()).findAllByRole("listitem");
  const messages = [/archive\.zip.*not supported/s, /empty\.txt.*empty/s, /big\.pdf.*limit is 1 MiB/s];
  expect(rejected).toHaveLength(messages.length);
  messages.forEach((message, index) => expect(rejected[index]).toHaveTextContent(message));
  expect(app.puts).toHaveLength(0);
  // A rejected file blocks sending (it would otherwise be omitted) until removed; it does not count toward the file limit.
  await userEvent.type(await composer(), "Review"); expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  expect(screen.getByText(/did not upload before sending/)).toBeInTheDocument();
  await chooseTextFiles({ "a.md": "# A", "b.md": "# B" });
  expect(await screen.findByText(/b\.md was not added: a message holds at most 1 file\./)).toBeInTheDocument();
  await waitFor(() => expect(app.puts).toHaveLength(1));
  for (const name of ["archive.zip", "empty.txt", "big.pdf"]) await userEvent.click(screen.getByRole("button", { name: `Remove ${name}` }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
});

test("a server refusal is shown with its reason; a transient failure can be retried with the same upload identity", async () => {
  const app = setup({ putStatus: n => n === 1 ? { status: 422, body: rawError } : n === 2 ? { status: 503, body: { error: "unavailable" } } : null });
  await chooseFile("scan.pdf", "%PDF-1.7 image only");
  const row = (await (await queuedAttachments()).findByText("scan.pdf")).closest("li")!;
  await within(row).findByText(/no text can be extracted/); expect(within(row).queryByRole("button", { name: /Retry/ })).toBeNull();
  await userEvent.click(within(row).getByRole("button", { name: "Remove scan.pdf" })); expect(app.deletes).toHaveLength(0);
  await chooseFile("flaky.md", "# Flaky");
  const flaky = (await within(list()).findByText("flaky.md")).closest("li")!;
  await within(flaky).findByText(/could not store this file \(HTTP 503\)/);
  await userEvent.click(within(flaky).getByRole("button", { name: /Retry/ })); await within(flaky).findByText("Ready to send");
  expect(app.puts[2]!.id).toBe(app.puts[1]!.id);
});

test("an upload the signed-in account may not make is refused visibly", async () => {
  setup({ putStatus: () => ({ status: 403, body: { request_id: "r", code: "forbidden", message: "no", retryable: false } }) });
  await chooseFile("spec.md", "# Spec");
  await screen.findByText(/refused to store this file for your account/);
  expect(screen.getByRole("button", { name: "Remove spec.md" })).toBeEnabled();
});

test("sending waits for uploads to settle and a failed removal keeps the file visible", async () => {
  const app = setup({ deleteStatus: 409 }); await chooseFile("spec.md", "# Spec");
  await userEvent.type(await composer(), "Review");
  await within(list()).findByText("Ready to send");
  await userEvent.click(screen.getByRole("button", { name: "Remove spec.md" }));
  await screen.findByText(/Not removed: .*already part of a sent message/);
  expect(within(list()).getByText("spec.md")).toBeInTheDocument(); expect(app.deletes).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
});

test("a rejected send explains that expired files must be attached again", async () => {
  const app = setup(); await chooseFile("spec.md", "# Spec"); await within(list()).findByText("Ready to send");
  app.staged.clear();
  await sendText("Review");
  await screen.findByText(/Not queued: the request was rejected\. If a file expired or was removed, remove it and attach it again\./);
});
