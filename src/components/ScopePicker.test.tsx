import { render, screen } from "@testing-library/react";
import { ScopePicker } from "./ScopePicker";

const scope = { kind: "project", project_id: "bogus" } as const;

test("SO-11: an unlisted project id is never shown as a project name", () => {
  const { rerender } = render(<ScopePicker scope={scope} onChange={() => {}} projects={[]} />);
  expect(screen.getByRole("option", { name: "Selected project" })).toHaveProperty("selected", true);
  expect(screen.queryByRole("option", { name: "bogus" })).toBeNull();
  rerender(<ScopePicker scope={scope} onChange={() => {}} projects={[{ id: "p1", label: "Project one" }]} projectsLoaded />);
  expect(screen.getByRole("option", { name: "Unavailable project" })).toHaveProperty("selected", true);
  expect(screen.getByRole("option", { name: "Project one" })).toBeInTheDocument();
});

test("a listed project keeps its label", () => {
  render(<ScopePicker scope={{ kind: "project", project_id: "p1" }} onChange={() => {}} projects={[{ id: "p1", label: "Project one" }]} projectsLoaded />);
  expect(screen.getByRole("option", { name: "Project one" })).toHaveProperty("selected", true);
  expect(screen.queryByRole("option", { name: /Unavailable/ })).toBeNull();
});
