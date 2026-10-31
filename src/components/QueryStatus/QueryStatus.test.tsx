import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { ApiError } from "../../api/client";
import { CountLabel } from "./CountLabel";
import { FreshnessLabel } from "./FreshnessLabel";
import { QueryStatus } from "./QueryStatus";

test("loading is announced and never looks empty", () => {
  render(<QueryStatus status="pending" error={null} label="tasks" onRetry={() => {}} />);
  expect(screen.getByRole("status")).toHaveTextContent(/loading tasks/i);
});

test("a failure offers retry and says the data is unavailable", async () => {
  const retry = vi.fn();
  render(<QueryStatus status="error" error={new ApiError("transport", "x")} label="tasks" onRetry={retry} />);
  expect(screen.getByRole("alert")).toHaveTextContent(/couldn't load tasks/i);
  await userEvent.click(screen.getByRole("button", { name: /try again/i }));
  expect(retry).toHaveBeenCalled();
});

test("a 403 says access is not permitted rather than offering retry", () => {
  render(
    <QueryStatus status="error" error={new ApiError("http", "x", { status: 403 })} label="tasks" onRetry={() => {}} />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(/not permitted/i);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("a 404 is neutral", () => {
  render(
    <QueryStatus status="error" error={new ApiError("http", "x", { status: 404 })} label="task" onRetry={() => {}} />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(/does not exist or is not available/i);
});

test("a contract error says this version cannot read the response", () => {
  render(<QueryStatus status="error" error={new ApiError("contract", "x")} label="tasks" onRetry={() => {}} />);
  expect(screen.getByRole("alert")).toHaveTextContent(/dashboard can't read/i);
});

test("an exact count renders as a number", () => {
  render(<CountLabel total={{ value: 12, accuracy: "exact" }} />);
  expect(screen.getByText("12")).toBeInTheDocument();
});

test("an estimated count is marked approximate", () => {
  render(<CountLabel total={{ value: 120, accuracy: "estimated" }} />);
  expect(screen.getByText("~120")).toHaveAccessibleName(/about 120/i);
});

test("an unknown count is never zero", () => {
  render(<CountLabel total={{ value: null, accuracy: "unknown" }} />);
  expect(screen.getByText("—")).toHaveAccessibleName(/unknown/i);
});

test("FreshnessLabel shows age, and a stale value says so", () => {
  const { rerender } = render(
    <FreshnessLabel serverTime="2026-10-31T12:00:00.000Z" observedAt="2026-10-31T11:59:58.000Z" stale={false} />,
  );
  expect(screen.getByText("updated 2s ago")).toBeInTheDocument();
  rerender(<FreshnessLabel serverTime="2026-10-31T12:00:00.000Z" observedAt="2026-10-31T11:00:00.000Z" stale />);
  expect(screen.getByText(/stale, observed 1h ago/i)).toBeInTheDocument();
});
