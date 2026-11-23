import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { apiGet } from "../../api/client";
import { adaptGraphPage, validGraphId } from "../../api/adapters/humanGraph";
import type { ResultComment, ResultDetail, ResultOperation } from "../../api/adapters/resultsFeedback";
import { graphPath } from "../../api/humanGraphReads";
import { queryKey } from "../../api/queryKeys";
import { useSession } from "../../app/session";
import { useResultOperation } from "./useResultOperation";
import {
  initialFields, feedbackParams, retainedFeedback, feedbackRequest,
  checkCommentGuard, type FeedbackFields,
} from "./feedbackDraftModel";

import { useFeedbackReceipt, verificationError } from "./useFeedbackReceipt";

const capability = "results.feedback";

const recoveryPath = (id: string) => `/api/v1/feedback-tasks/${id}/recover`;
export type FeedbackSource = { detail: ResultDetail; comments: ResultComment[]; initial?: string; onRefresh?(): Promise<ResultComment[]> };

function useFeedbackFields({ detail, comments, initial }: FeedbackSource) {
  const [fields, setFields] = useState(() => initialFields(detail, comments, initial));
  function update(changes: Partial<FeedbackFields>) {
    setFields(previous => ({ ...previous, ...changes }));
  }
  useEffect(() => {
    const first = comments[0];
    if (!fields.commentId && first) setFields(previous => ({
      ...previous, commentId: first.id, description: previous.description || first.body,
    }));
  }, [fields.commentId, comments]);
  const comment = comments.find(item => item.id === fields.commentId);
  return { fields, comment, update };
}

function useFeedbackContext(fields: FeedbackFields) {
  const { bootstrap, queryContext } = useSession();
  const enabled = bootstrap.capability(capability).enabled;
  const { project, mode } = fields;
  const context = useQuery({
    queryKey: queryKey(queryContext, "result-feedback-context", { project }),
    enabled: enabled && validGraphId(project) && mode === "create", retry: false, refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const raw = await apiGet<unknown>(graphPath(project, "task") + "?limit=1", signal);
      return adaptGraphPage(raw, project, "task").project;
    },
  });
  return { context, enabled };
}

export function useFeedbackDraft(source: FeedbackSource) {
  const { detail, onRefresh } = source;
  const { fields, comment, update } = useFeedbackFields(source);
  const { context, enabled } = useFeedbackContext(fields);
  const receipt = useFeedbackReceipt(detail, update);
  const [params, setParams] = useSearchParams();
  const initialId = useRef(retainedFeedback(params, detail));
  const retained = initialId.current;
  const operation = useResultOperation(detail.result.project_id, capability, retained ? { id: retained, recoveryPath: recoveryPath(retained) } : undefined);
  const creating = fields.mode === "create";
  useEffect(() => {
    if (retained) void operation.lookup()?.then(value => { if (value) void receipt.verify(retained); });
    // Recover the retained operation once on mount without resubmitting its request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function setReference(id?: string) {
    setParams(old => feedbackParams(old, id ? { id, detail } : undefined), { replace: true });
  }
  function checked(value: ResultOperation, id = operation.id) {
    if (creating && id) return receipt.verify(id);
    if (!creating && value.disposition === "confirmed") receipt.setLinked(fields.existing);
  }
  async function send(body: ReturnType<typeof feedbackRequest>) {
    const id = body.operation_id;
    receipt.origin.current = body;
    if (creating) {
      setReference(id);
      return operation.submit("POST", "/api/v1/feedback-tasks", body, recoveryPath(id));
    }
    return operation.submit("POST", "/api/v1/feedback-links", body);
  }
  function hasProjectGuard() {
    return !creating || !!context.data;
  }
  function warnSubmission() {
    receipt.setError(operation.id ? verificationError : "Check the title, description, criteria and task pins before submitting.");
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!comment) return;
    if (operation.id || !enabled) return;
    if (!hasProjectGuard()) return;
    receipt.setError(null);
    try {
      const body = feedbackRequest(detail, comment, fields, context.data?.revision);
      const result = await send(body);
      if (result?.disposition === "confirmed") await checked(result, body.operation_id);
    } catch {
      warnSubmission();
    }
  }
  async function refreshGuards() {
    try {
      const [next, latest] = await Promise.all([context.refetch(), onRefresh?.()]);
      if (creating && next.error) throw next.error;
      checkCommentGuard(latest, receipt.origin.current);
      receipt.setError(null);
      setReference();
    } catch {
      receipt.setError("Could not refresh the original comment and project guards. Keep this operation reference and reopen the exact revision.");
      throw new Error("Feedback guards unavailable");
    }
  }
  function restart() {
    operation.reset();
    receipt.setLinked(null);
    receipt.setError(null);
    initialId.current = undefined;
    setReference();
    void context.refetch();
  }
  return { fields, update, comment, context, enabled, operation, creating,
    error: receipt.error, linked: receipt.linked, submit, checked, refreshGuards, restart };
}
