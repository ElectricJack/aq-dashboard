import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { handlersFor } from "../mocks/handlers";
import { renderApp } from "../test/renderApp";

const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test("SO-23: every page names itself in the document title", async () => {
  const { router } = renderApp("/overview");
  await screen.findByRole("heading", { level: 1, name: "Overview" });
  expect(document.title).toBe("Overview — Agent Q");
  await act(() => router.navigate("/work"));
  await waitFor(() => expect(document.title).toBe("Work — Agent Q"));
  await act(() => router.navigate("/settings"));
  await waitFor(() => expect(document.title).toBe("Settings — Agent Q"));
  await act(() => router.navigate("/no-such-page"));
  await screen.findByRole("heading", { level: 1, name: "Page not found" });
  expect(document.title).toBe("Page not found — Agent Q");
});

test("SO-14/ISSUE-007: Back returns focus to the link that opened the page", async () => {
  const { router } = renderApp("/overview");
  const link = await screen.findByRole("link", { name: /All sessions/ });
  const href = link.getAttribute("href");
  await userEvent.click(link);
  await waitFor(() => expect(router.state.location.pathname).toBe("/agents/history"));
  await act(() => router.navigate(-1));
  await waitFor(() => expect(document.activeElement?.getAttribute("href")).toBe(href));
  expect(document.activeElement?.tagName).toBe("A");
});

test("each history entry remembers its own initiating link across several Backs", async () => {
  const { router } = renderApp("/overview");
  const link = await screen.findByRole("link", { name: /All sessions/ });
  await userEvent.click(link);
  await waitFor(() => expect(router.state.location.pathname).toBe("/agents/history"));
  await userEvent.click(screen.getByRole("link", { name: "Settings" }));
  await screen.findByRole("heading", { level: 1, name: "Settings" });
  await act(() => router.navigate(-1));
  // History was left through the rail, so the usual heading focus applies there.
  await waitFor(() => expect(router.state.location.pathname).toBe("/agents/history"));
  await act(() => router.navigate(-1));
  await waitFor(() => expect(document.activeElement).toHaveAccessibleName(/All sessions/));
});
