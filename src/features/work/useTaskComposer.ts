import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useSession } from "../../app/session";
import { useDraft } from "../../app/useDraft";
import { ApiError, apiGet } from "../../api/client";
import { queryKey } from "../../api/queryKeys";
import { graphPath } from "../../api/humanGraphReads";
import { adaptGraphPage, validGraphId, type GraphNode } from "../../api/adapters/humanGraph";
import {
  freezeTaskCreate,
  type FrozenTaskCreate,
  type TaskOperation,
} from "../../api/adapters/taskCreate";
import {
  blankTask,
  validDraft,
  draftProblem,
  creationSnapshot,
  requestCreation,
  readCreatedTask,
  refreshTaskLists,
  invalidSubmission,
  missingOperation,
  terminalOperation,
  type CreateAttempt,
} from "./taskCreationModel";
export function useTaskComposer(project: string, onAccessRevoked: () => void) {
  const { bootstrap, queryContext, reportIncompatible, reportAccessDenied } = useSession();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const raw = params.get("operation");
  const selectedOperation = validGraphId(raw) ? raw : undefined;
  const [open, setOpen] = useState(!!selectedOperation);
  const [draft, setDraft] = useDraft(`task-create:${project}`, blankTask, validDraft);
  const [frozenIntent, setFrozen] = useState<FrozenTaskCreate | null>(null);
  const [operationStatus, setStatus] = useState<TaskOperation | null>(null);
  const [verifiedTask, setCreated] = useState<GraphNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The server has no record of this operation id (404 on lookup): it was refused before it was recorded, or is still in flight (WD-06).
  const [unrecorded, setUnrecorded] = useState<{ id: string; message?: string } | null>(null);
  const active = useRef(true),
    busyRef = useRef(false),
    frozenRef = useRef<FrozenTaskCreate | null>(null),
    request = useRef<AbortController | null>(null);
  const initialLookup = useRef<string | null>(null);
  const sequence = useRef(0),
    urlOperation = useRef(selectedOperation),
    internalUrl = useRef<{ value: string | undefined } | null>(null);
  const { operation, frozen, status, created } = creationSnapshot({
    selected: selectedOperation,
    internal: internalUrl.current?.value,
    intent: frozenIntent,
    statusValue: operationStatus,
    task: verifiedTask,
  });
  const context = useQuery({
    queryKey: queryKey(queryContext, "task-create-context", { project }),
    enabled: open && !operation,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 0,
    queryFn: async ({ signal }) =>
      adaptGraphPage(await apiGet<unknown>(`${graphPath(project, "task")}?limit=1`, signal), project, "task")
        .project,
  });
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, []);
  useLayoutEffect(() => {
    if (urlOperation.current === selectedOperation) return;
    urlOperation.current = selectedOperation;
    const own = internalUrl.current !== null && internalUrl.current.value === selectedOperation;
    internalUrl.current = null;
    if (own) return; // Our first submit/revise changes the URL without replacing its intent.
    sequence.current++;
    request.current?.abort();
    request.current = null;
    busyRef.current = false;
    setBusy(false);
    clearPrivate();
    setOpen(!!selectedOperation);
  }, [selectedOperation]);

  function clearPrivate() {
    frozenRef.current = null;
    setFrozen(null);
    setStatus(null);
    setCreated(null);
    setDraft({ ...blankTask });
    setReadError(null);
    setError(null);
    setUnrecorded(null);
    initialLookup.current = null;
  }
  function current(ticket: number) {
    return active.current && sequence.current === ticket;
  }
  /** A 403 is one refused request, not a sign-out (WD-05): keep the draft and say so in the dialog. A refused submission was never admitted, so the draft is editable again. */
  function refused(reason: ApiError, submission: boolean) {
    reportAccessDenied(reason);
    const why = reason.envelope?.message ? ` ${reason.envelope.message}.` : "";
    if (submission) {
      frozenRef.current = null;
      setFrozen(null);
      setStatus(null);
      setCreated(null);
      operationParam();
      setError(`AQ refused this request; no task was created.${why} Your draft is preserved.`);
    } else setError(`AQ refused checking this operation.${why}`);
  }
  /** A definitive 4xx on submit (WDR-03): AQ refused the request as invalid before admitting it, so nothing was created and
   * the same bytes can only fail again. Show AQ's reason and make the draft editable, never "outcome uncertain". */
  function invalid(reason: ApiError) {
    const why = reason.serverMessage ? ` AQ: “${reason.serverMessage}”.` : "";
    frozenRef.current = null;
    setFrozen(null);
    setStatus(null);
    setCreated(null);
    setUnrecorded(null);
    operationParam();
    setError(
      `AQ refused this task as invalid; no task was created.${why} Check the fields and submit again. Your draft is preserved.`,
    );
  }
  function revokeAccess(reason: ApiError) {
    reportAccessDenied(reason);
    sequence.current++;
    active.current = false;
    request.current?.abort();
    request.current = null;
    busyRef.current = false;
    setBusy(false);
    clearPrivate();
    onAccessRevoked();
    void client.invalidateQueries({ queryKey: ["bootstrap"] });
  }
  function operationParam(value?: string) {
    internalUrl.current = { value };
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set("operation", value);
        else next.delete("operation");
        return next;
      },
      { replace: true },
    );
  }
  async function verifyTask(value: TaskOperation, signal: AbortSignal, ticket: number) {
    if (value.state !== "confirmed" || !value.receipt) return;
    try {
      const node = await readCreatedTask(project, value, signal);
      if (!current(ticket)) return;
      setCreated(node);
      setReadError(null);
      refreshTaskLists(client, queryContext.principalId);
    } catch (reason) {
      if (current(ticket)) handleReadError(reason);
    }
  }
  function handleReadError(reason: unknown) {
    if (handleSessionError(reason)) return;
    setCreated(null);
    if (reason instanceof ApiError && reason.status === 403) {
      reportAccessDenied(reason);
      setReadError("The creation receipt is confirmed, but AQ refused reading the task record.");
    } else
      setReadError(
        "The creation receipt is confirmed, but the task record could not be read. Check the task record again.",
      );
  }
  function handleSessionError(reason: unknown) {
    if (!(reason instanceof ApiError)) return false;
    if (reason.status === 401) {
      revokeAccess(reason);
      return true;
    }
    if (reason.status === 426) {
      reportIncompatible("tasks.create");
      return true;
    }
    return false;
  }
  function handleAttemptError(reason: unknown, attempt: CreateAttempt) {
    if (handleSessionError(reason)) return;
    if (reason instanceof ApiError) {
      if (reason.status === 403) return refused(reason, attempt.kind === "submit");
      if (invalidSubmission(attempt.kind, reason)) return invalid(reason);
    }
    setCreated(null);
    if (missingOperation(attempt.kind, reason)) {
      setUnrecorded({ id: attempt.id, message: reason.serverMessage });
      setError(null);
      return;
    }
    setError("The operation outcome is not confirmed. Check its status before starting another task.");
  }
  async function execute(kind: "submit" | "lookup" | "recover", id: string, intent?: FrozenTaskCreate) {
    const ticket = ++sequence.current;
    const controller = new AbortController();
    request.current = controller;
    try {
      const value = await requestCreation(
        { kind, id, intent },
        project,
        queryContext.principalId,
        controller.signal,
      );
      if (!current(ticket)) return;
      setStatus(value);
      setUnrecorded(null);
      setCreated(null);
      setReadError(null);
      setError(null);
      if (value.state === "confirmed") setDraft({ ...blankTask });
      await verifyTask(value, controller.signal, ticket);
    } catch (reason) {
      if (current(ticket)) handleAttemptError(reason, { kind, id, intent });
    } finally {
      if (current(ticket)) {
        setBusy(false);
        busyRef.current = false;
      }
      if (request.current === controller) request.current = null;
    }
  }
  async function lookup() {
    await resume("lookup");
  }
  useEffect(() => {
    if (
      !selectedOperation ||
      frozenRef.current?.operationId === selectedOperation ||
      initialLookup.current === selectedOperation
    )
      return;
    initialLookup.current = selectedOperation;
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    void execute("lookup", selectedOperation);
    // A reload recovers server-retained identity; it never reconstructs a POST body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOperation]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busyRef.current || operation) return;
    if (!context.data || context.isFetching) return;
    // AQ counts the (trimmed) title in UTF-8 bytes, like Edit (WDR-03): accented letters and emoji take 2 to 4.
    const requestDraft = canSetStoryPoints ? draft : { ...draft, storyPoints: undefined };
    const problem = draftProblem(requestDraft);
    if (problem) {
      setError(problem);
      return;
    }
    await submitDraft(requestDraft, context.data.revision);
  }
  async function submitDraft(requestDraft: typeof draft,revision: string) {
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const preparation = sequence.current;
    try {
      const intent = await freezeTaskCreate(
        project,
        queryContext.principalId,
        revision,
        requestDraft,
      );
      if (!current(preparation)) return;
      setStatus(null);
      setCreated(null);
      setReadError(null);
      frozenRef.current = intent;
      setFrozen(intent);
      operationParam(intent.operationId);
      await execute("submit", intent.operationId, intent);
    } catch {
      if (current(preparation)) {
        setError("The task request could not be prepared. Your draft is preserved.");
        setBusy(false);
        busyRef.current = false;
      }
    }
  }
  async function recover() {
    if (!status?.recovery.allowed) return;
    await resume("recover");
  }
  async function retryOriginal() {
    const intent = frozenRef.current;
    if (!intent || intent.operationId !== operation) return;
    await resume("submit");
  }
  async function resume(kind: CreateAttempt["kind"]) {
    if (!operation || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    await execute(
      kind,
      operation,
      frozenRef.current?.operationId === operation ? frozenRef.current : undefined,
    );
  }
  /** Leave an operation AQ never recorded and return to the composer with the local draft (WD-06). */
  function startOver() {
    if (busyRef.current) return;
    if (!operation || unrecorded?.id !== operation) return;
    frozenRef.current = null;
    setFrozen(null);
    setStatus(null);
    setCreated(null);
    setReadError(null);
    setError(null);
    setUnrecorded(null);
    initialLookup.current = null;
    operationParam();
    void context.refetch();
  }
  function revise() {
    if (busyRef.current) return;
    if (!status || !terminalOperation(status)) return;
    if (status.state === "confirmed") setDraft({ ...blankTask });
    frozenRef.current = null;
    setFrozen(null);
    setStatus(null);
    setCreated(null);
    setReadError(null);
    setError(null);
    initialLookup.current = null;
    operationParam();
    void context.refetch();
  }
  const canSetStoryPoints = bootstrap.capability("tasks.story_points").enabled;
  function leaveConfirmedTask() {
    setOpen(false);
    clearPrivate();
  }
  const terminal = terminalOperation(status);
  function launch() {
    setOpen(true);
    if (!operation) void context.refetch();
  }
  return {
    open,
    setOpen,
    launch,
    draft,
    setDraft,
    operation,
    context,
    error,
    frozen,
    busy,
    submit,
    canSetStoryPoints,
    status,
    created,
    unrecorded,
    readError,
    lookup,
    recover,
    retryOriginal,
    terminal,
    revise,
    startOver,
    leaveConfirmedTask,
  };
}
export type TaskComposer = ReturnType<typeof useTaskComposer>;
