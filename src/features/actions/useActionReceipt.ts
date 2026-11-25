import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../../api/client";
import { ContractError } from "../../api/adapters/contract";
import { useSession } from "../../app/session";
import { actionRequest, type ActionOperation, type FrozenAction } from "./actionClient";

type Receipt = {
  operation: ActionOperation | null; retired: boolean; unknown: boolean; accessLost: boolean; error: string | null;
};
const EMPTY: Receipt = { operation: null, retired: false, unknown: false, accessLost: false, error: null };
type Messages = { conflict(): string; rejected: string; machineNode?: string };
type Reports = Pick<ReturnType<typeof useSession>, "reportAccessDenied" | "reportIncompatible">;

function settled(value: FrozenAction, failure: ApiError, disposition: "conflict" | "rejected", message: string): Partial<Receipt> {
  const operation: ActionOperation = {
    operation_id: value.id, disposition, request_digest: "", subject_refs: [], receipt_refs: [], affected_entities: [],
    ...(disposition === "conflict" ? { current_versions: failure.envelope?.current_versions } : {}), recovery: "refresh_and_review",
  };
  return { operation, unknown: false, error: failure.envelope?.message ?? message };
}

function submissionFailure(value: FrozenAction, failure: ApiError, messages: Messages): Partial<Receipt> {
  if (failure.status === 409) {
    if (messages.machineNode && failure.envelope?.code === "machine_node") return settled(value, failure, "rejected", messages.machineNode);
    return settled(value, failure, "conflict", messages.conflict());
  }
  if (!failure.effectUnknown && [400, 404, 413, 422].includes(failure.status ?? 0)) return settled(value, failure, "rejected", messages.rejected);
  return { unknown: true, error: null };
}

function responseFailure(failure: unknown, reports: Reports): Partial<Receipt> | undefined {
  if (!(failure instanceof ApiError)) return { unknown: true, error: null };
  switch (failure.status) {
    case 401:
    case 403:
      reports.reportAccessDenied(failure);
      return { accessLost: true, operation: null, error: "Access changed. Reload access before checking the operation." };
    case 426:
      reports.reportIncompatible("dashboard.actions");
      return { unknown: true };
    case 410:
      return { retired: true, unknown: false, error: null };
  }
}

export function verifyActionIdentity(previous: ActionOperation | null, next: ActionOperation) {
  if (!previous?.request_digest || previous.operation_id !== next.operation_id) return;
  if (previous.request_digest !== next.request_digest) throw new ContractError("Operation identity changed");
}

function isUnsettled(receipt: Receipt) {
  const disposition = receipt.operation?.disposition ?? "unknown";
  return receipt.retired || receipt.unknown || ["pending", "unknown"].includes(disposition);
}

function receiptStatus(receipt: Receipt) {
  if (receipt.retired) return "retired" as const;
  return receipt.unknown ? "unknown" as const : receipt.operation?.disposition;
}

export function useActionReceipt(messages: Messages, onConfirmed?: () => void) {
  const reports = useSession();
  const [intent, setIntent] = useState<FrozenAction | null>(null);
  const [receipt, setReceipt] = useState(EMPTY), [busy, setBusy] = useState(false);
  const lock = useRef(false), current = useRef(true), controller = useRef<AbortController | null>(null);
  const firstLookup = useRef<string | null>(null);
  const merge = (patch: Partial<Receipt>) => setReceipt(previous => ({ ...previous, ...patch }));
  const { operation, error, retired, accessLost } = receipt;
  const unsettled = !!intent && isUnsettled(receipt);

  useEffect(() => {
    current.current = true;
    return () => { current.current = false; controller.current?.abort(); };
  }, []);

  function failed(failure: unknown, value: FrozenAction, lookup: boolean) {
    const patch = responseFailure(failure, reports);
    if (patch) return merge(patch);
    if (lookup || !(failure instanceof ApiError)) return merge({ unknown: true, error: null });
    merge(submissionFailure(value, failure, messages));
  }

  function finish(abort: AbortController) {
    lock.current = false;
    if (current.current) setBusy(false);
    if (controller.current === abort) controller.current = null;
  }

  async function run(value: FrozenAction, lookup = false) {
    if (lock.current || accessLost) return;
    lock.current = true; setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const next = await actionRequest(value, lookup, abort.signal);
      if (!current.current) return;
      verifyActionIdentity(operation, next);
      merge({ operation: next, unknown: false, error: null });
      if (next.disposition === "confirmed") onConfirmed?.();
    } catch (failure) {
      if (current.current) failed(failure, value, lookup);
    } finally { finish(abort); }
  }

  useEffect(() => {
    if (!intent || !unsettled || busy || accessLost || retired) return;
    const delay = firstLookup.current === intent.id ? 2000 : 0;
    firstLookup.current = intent.id;
    const timer = setTimeout(() => void run(intent, true), delay);
    return () => clearTimeout(timer);
  }, [intent, unsettled, busy, accessLost, retired]);

  async function submit(event: FormEvent, disabled: boolean, prepare: () => FrozenAction, invalid: (failure: unknown) => void) {
    event.preventDefault();
    if (disabled || lock.current) return;
    if (intent) return;
    let value: FrozenAction;
    try { value = prepare(); } catch (failure) { invalid(failure); return; }
    setIntent(value); merge({ error: null });
    await run(value);
  }

  async function reload(refresh: (() => Promise<unknown> | void) | undefined, reset: () => void) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await refresh?.(); if (current.current) reset(); }
    catch { if (current.current) merge({ error: "Current versions could not be loaded. Your draft is preserved." }); }
    finally { lock.current = false; if (current.current) setBusy(false); }
  }

  function resetReceipt() { setIntent(null); merge({ operation: null, retired: false, unknown: false, error: null }); }
  function forgetReceipt() { setIntent(null); merge({ operation: null, error: null }); }
  return {
    intent, operation, status: receiptStatus(receipt), error, setError: (error: string | null) => merge({ error }),
    retired, accessLost, busy, unsettled, run, submit, reload, resetReceipt, forgetReceipt,
  };
}
