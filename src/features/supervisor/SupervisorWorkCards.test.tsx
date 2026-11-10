import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import graphRequest from "../../../contracts/live/supervisor-conversation/task-graph-create.fixture.json";
import taskRequest from "../../../contracts/live/dashboard-actions/fixtures/request-task-create.json";
import { SupervisorTaskProposal, SupervisorWorkReceipt, SupervisorHistoryReceipt } from "./SupervisorWorkCards";
import type { ActionOperation } from "../actions/actionClient";

test("typed F2 task proposal is editable and only explicit Create authorizes the edited draft", async () => {
  const create = vi.fn();
  render(<SupervisorTaskProposal draft={taskRequest.payload} onCreate={create} />);
  expect(create).not.toHaveBeenCalled();
  const title = screen.getByRole("textbox", { name: "Task title" });
  await userEvent.clear(title); await userEvent.type(title, "Scope I approved");
  await userEvent.click(screen.getByRole("button", { name: "Create task" }));
  expect(create).toHaveBeenCalledOnce(); expect(create.mock.calls[0]?.[0]).toMatchObject({ title: "Scope I approved", body: taskRequest.payload.body });
});
test("confirmed F2 graph receipts link each created task and pending receipts claim no creation", () => {
  const operation = { disposition: "confirmed", operation_id: taskRequest.operation_id, affected_entities: graphRequest.payload.tasks.map(task => ({ type: "task", id: task.id, revision: "1" })) } as ActionOperation;
  const view = render(<MemoryRouter><SupervisorWorkReceipt kind="task.graph.create" operation={operation} /></MemoryRouter>);
  expect(screen.getAllByRole("link", { name: /Open task/ }).map(link => link.getAttribute("href"))).toEqual(graphRequest.payload.tasks.map(task => `/work/${task.id}`));
  view.rerender(<MemoryRouter><SupervisorWorkReceipt kind="task.graph.create" operation={{ ...operation, disposition: "pending" }} /></MemoryRouter>);
  expect(screen.queryByRole("link")).toBeNull();
});


test("history task receipts carry their project scope into Work",()=>{
 const receipt={type:'action_receipt',project_id:taskRequest.subject.id,created_task_ids:[taskRequest.operation_id],kind:'task.create'} as import('../../api/adapters/supervisor').ActionReceiptAttachment;
 render(<MemoryRouter><SupervisorHistoryReceipt receipt={receipt}/></MemoryRouter>);
 expect(screen.getByRole('link',{name:/Open task/})).toHaveAttribute('href',`/work/${taskRequest.operation_id}?scope=project%3A${taskRequest.subject.id}`);
});
