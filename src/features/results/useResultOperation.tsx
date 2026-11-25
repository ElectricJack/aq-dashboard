import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { adaptResultOperation, type ResultOperation } from "../../api/adapters/resultsFeedback";
import { useSession } from "../../app/session";

import { readOperation, updateResultFeed, checkIdentity, outcomeError, permitsRecovery, completed, type Intent, type Attempt } from "./resultOperationOutcome";

/** Each capability change closes the previous generation and aborts its outstanding read or write. */
function useAttemptScope(enabled: boolean) {
  const active = useRef(true);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    active.current = true;
    request.current = null;
    setBusy(false);
    return () => {
      active.current = false;
      generation.current++;
      request.current?.abort();
      request.current = null;
    };
  }, [enabled]);

  function canStart(kind: Attempt) {
    if (request.current || !active.current) return false;
    return kind === "lookup" || enabled;
  }

  function start() {
    const controller = new AbortController();
    const ticket = generation.current;
    request.current = controller;
    setBusy(true);
    const current = () => generation.current === ticket;
    return {
      signal: controller.signal, current,
      finish() {
        if (current()) setBusy(false);
        if (request.current === controller) request.current = null;
      },
    };
  }
  return { busy, canStart, start, locked: () => request.current !== null };
}

/** A frozen request owns one operation key until an explicit terminal reset. */
export function useResultOperation(project: string, capability: string, initial?: { id: string; recoveryPath?: string }) {
  const client = useQueryClient();
  const session = useSession();
  const scope = useAttemptScope(session.bootstrap.capability(capability).enabled);
  const intent = useRef<Intent | null>(initial ? { ...initial, method: "POST", path: "", body: {} } : null);
  const [id, setId] = useState<string | null>(initial?.id ?? null);
  const [status, setStatus] = useState<ResultOperation | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const terminal = refused !== null || completed(status);

  async function execute(kind: Attempt, value: Intent) {
    if (!scope.canStart(kind)) return;
    const attempt = scope.start();
    setUnknown(false);
    setRefused(null);
    try {
      const raw = await readOperation(kind, value, attempt.signal);
      const op = adaptResultOperation(raw, value.id, project);
      if (!attempt.current()) return;
      checkIdentity(status, op);
      setStatus(op);
      updateResultFeed(client, session.queryContext, op);
      return op;
    } catch (error) {
      if (!attempt.current()) return;
      const reason = outcomeError(error, session, capability);
      if (reason === null) setUnknown(true);
      else setRefused(reason);
    } finally {
      attempt.finish();
    }
  }

  async function submit(method: Intent["method"], path: string, body: Record<string, unknown>, recoveryPath?: string) {
    if (intent.current || !scope.canStart("submit")) return;
    const value = { id: String(body.operation_id), method, path, body: structuredClone(body), recoveryPath };
    intent.current = value;
    setId(value.id);
    clearOutcome();
    return execute("submit", value);
  }

  function clearOutcome() {
    setStatus(null);
    setUnknown(false);
    setRefused(null);
  }

  function recover() {
    if (intent.current?.recoveryPath && permitsRecovery(status)) return execute("recover", intent.current);
  }

  function reset() {
    if (!terminal || scope.locked()) return;
    intent.current = null;
    setId(null);
    clearOutcome();
  }

  return { id, status, busy: scope.busy, unknown, refused, terminal, submit, recover, reset,
    lookup: () => intent.current ? execute("lookup", intent.current) : undefined };
}

export type ResultOperationControl = ReturnType<typeof useResultOperation>;

export { OperationStatus } from "./ResultOperationStatus";
