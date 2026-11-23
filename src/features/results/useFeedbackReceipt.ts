import { useEffect, useRef, useState } from "react";
import type { ResultDetail } from "../../api/adapters/resultsFeedback";
import type { FeedbackTaskStatus } from "../../api/wire/resultsFeedback";
import { ApiError, apiGet } from "../../api/client";
import { useSession } from "../../app/session";
import { readFeedbackReceipt, checkFeedbackPins, checkRecoveredOrigin, recoveredFields, type FeedbackFields, type FeedbackRequest } from "./feedbackDraftModel";

export const verificationError = "The feedback task link could not be verified. Check the original operation.";
function confirmedFeedback(data: FeedbackTaskStatus) {
  return data.creation_disposition === "confirmed" && data.link_confirmed;
}
function verificationFailure(reason: unknown, session: ReturnType<typeof useSession>) {
  if (!(reason instanceof ApiError)) return verificationError;
  if (reason.status === 426) session.reportIncompatible("results.feedback");
  if (reason.status !== 401 && reason.status !== 403) return verificationError;
  session.reportAccessDenied(reason);
  if (reason.status === 401) return verificationError;
  const message = reason.serverMessage ? ` ${reason.serverMessage}.` : "";
  return `AQ refused this request.${message} Your draft is preserved.`;
}

export function useFeedbackReceipt(detail: ResultDetail, restore: (fields: Partial<FeedbackFields>) => void) {
  const session = useSession();
  const origin = useRef<FeedbackRequest | null>(null);
  const verification = useRef<AbortController | null>(null);
  const [linked, setLinked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => verification.current?.abort(), []);
  function applyReceipt(raw: unknown, id: string) {
    const data = readFeedbackReceipt(raw, detail);
    if (!origin.current) {
      checkRecoveredOrigin(data.origin, detail);
      origin.current = data.origin;
      restore(recoveredFields(data.origin));
    }
    checkFeedbackPins(data, id, detail, origin.current);
    if (confirmedFeedback(data)) {
      setLinked(data.task_id);
      setError(null);
    } else setError("Task creation or linking is not yet confirmed. Check the original operation.");
  }
  async function verify(id: string) {
    verification.current?.abort();
    const controller = new AbortController();
    verification.current = controller;
    try {
      const raw = await apiGet<unknown>(`/api/v1/feedback-tasks/${id}`, controller.signal);
      if (!controller.signal.aborted) applyReceipt(raw, id);
    } catch (reason) {
      if (!controller.signal.aborted) setError(verificationFailure(reason, session));
    }
  }
  return { origin, verify, linked, setLinked, error, setError };
}
