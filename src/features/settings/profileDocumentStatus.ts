import { ApiError, isHttpClientError } from "../../api/client";
import { problemsOf, type Fence, type Problem } from "../../api/roleSettings";

export function isConflict(error: unknown) {
  return error instanceof ApiError && error.status === 409;
}

export type Pending = { key: string; id: string; request: Fence & { markdown: string } };
export type Status = { problems?: Problem[]; error?: string; notice?: string; retry?: Pending };
export type RowAlert = { title: string; problems: Problem[]; error?: string };

export type DocumentAction = {
  verb: "delete" | "enable" | "disable";
  run(fence: Fence): Promise<unknown>;
  done: string | null;
};

export function saveRefusal(error: ApiError, noun: string): Status {
  const problems = problemsOf(error);
  return problems.length ? { problems } : { error: error.serverMessage ?? `AQ refused this ${noun}.` };
}

export function actionError(error: unknown, noun: string): string {
  if (!isHttpClientError(error)) return "The change could not be confirmed. Reload to see whether it was applied.";
  return error.status === 409 ? `This ${noun} changed since it was read. Review it, then try again.` : error.serverMessage ?? "AQ refused the change.";
}

export function conflictNotice(noun: string, pending: Pending): string {
  if (pending.request.expected_revision === "0") return `A ${noun} with the id “${pending.id}” already exists. Your text is kept. Change its id, or open the existing ${noun}.`;
  return `This ${noun} changed since you opened it. Your text is kept and the saved version is shown beside it. Save again to replace the saved version, or discard your changes.`;
}
