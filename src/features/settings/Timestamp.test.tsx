import { render, screen } from "@testing-library/react";
import { Timestamp } from "./Timestamp";

test("a timestamp reads as a local date and time and keeps the ISO instant (ISSUE-014)", () => {
  render(<p data-testid="t"><Timestamp iso="2026-11-06T02:36:26.400064Z" /></p>);
  const time = screen.getByTestId("t").querySelector("time")!;
  expect(time).toHaveAttribute("title", "2026-11-06T02:36:26.400064Z");
  expect(time.textContent).toBe(new Date("2026-11-06T02:36:26.400064Z").toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
});
test("an unparseable value is shown as recorded", () => {
  render(<p data-testid="t"><Timestamp iso="not a time" /></p>);
  expect(screen.getByTestId("t")).toHaveTextContent("not a time");
});
