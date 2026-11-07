import { isFocusedSessionPath } from "./focusedSession";

test("only a session page is focused; the roster is not", () => {
  expect(isFocusedSessionPath("/agents/sess-07")).toBe(true);
  expect(isFocusedSessionPath("/agents/sess-07/")).toBe(true);
  expect(isFocusedSessionPath("/agents/sessions")).toBe(false);
  expect(isFocusedSessionPath("/agents/sessions/")).toBe(false);
  expect(isFocusedSessionPath("/agents")).toBe(false);
  expect(isFocusedSessionPath("/agents/sessionsx")).toBe(true);
});
