import { ApiError } from "../../api/client";
import { ContractError } from "../../api/adapters/contract";

export type Outcome = "unknown" | "refused" | null;
type AnswerResult = { outcome: Outcome; message: string; accessDenied?: boolean; incompatible?: boolean };
const CHANGED: AnswerResult = { outcome: "refused", message: "The question changed or was already answered. Your answer is preserved; refresh the question before answering again." };
const REJECTED: AnswerResult = { outcome: "refused", message: "The server refused this answer. Your answer is preserved; refresh the question before answering again." };

export function answerResult(disposition: string): AnswerResult {
  switch (disposition) {
    case "confirmed": return { outcome: null, message: "Answer recorded." };
    case "conflict": return CHANGED;
    case "rejected": return REJECTED;
    default: return { outcome: "unknown", message: "The answer is not confirmed yet. Check its status or retry the same answer; no second answer is created." };
  }
}

function unknownResult(error: unknown): AnswerResult {
  return { outcome: "unknown", message: error instanceof ContractError
    ? "The answer response could not be verified. Check its status before retrying."
    : "Delivery is unknown. Check its status or retry the same answer; no second answer is created." };
}

export function questionFailure(error: unknown, lookup: boolean): AnswerResult {
  if (!(error instanceof ApiError)) return unknownResult(error);
  if (error.status === 401) return { accessDenied: true, outcome: "refused", message: "Your sign-in has expired. Your answer is preserved; sign in through AQ, then reload." };
  if (error.status === 403) return { accessDenied: true, outcome: "refused", message: `AQ refused this answer.${error.serverMessage ? ` ${error.serverMessage}.` : ""} Your answer is preserved.` };
  if (error.status === 426) return { incompatible: true, outcome: null, message: "Answering requires a compatible AQ API. Your answer is preserved." };
  return lookup ? unknownResult(error) : submissionFailure(error);
}

function submissionFailure(error: ApiError): AnswerResult {
  if (error.status === 409) return CHANGED;
  if (!error.effectUnknown && [400, 404, 413, 422].includes(error.status ?? 0)) return REJECTED;
  return unknownResult(error);
}
