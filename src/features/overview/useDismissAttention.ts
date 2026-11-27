import { useMutation, useMutationState, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import type { AttentionView, OverviewView } from "../../api/adapters/inspection";
import { ATTENTION_DISMISS, dismissAttention } from "../../api/attentionDismiss";
import { useSession } from "../../app/session";
import type { Read } from "../../app/useRead";
import { refreshOverview } from "../decisions/decisionHooks";

/**
 * Kinds that are informational or stale. Decisions, questions and review gates need a real
 * answer and uncertain operations need reconciling, so none of them can be cleared here.
 */
const DISMISSIBLE_KINDS: ReadonlySet<AttentionView["kind"]> = new Set(["blocked", "failed", "worker_offline", "internal_work"]);

/** A decision-style action marks a gate that someone must resolve, whatever the kind says. */
function isGate(item: AttentionView) {
  return item.action !== null && /^(decision|review|question)\b/.test(item.action.kind);
}

export function dismissible(item: AttentionView): boolean {
  return DISMISSIBLE_KINDS.has(item.kind) && !isGate(item) && Boolean(item.subject.revision);
}

const DISMISS_KEY = ["attention-dismiss"] as const;

type Cached = Read<OverviewView>;

function withoutItem(cached: Cached, id: string): Cached {
  const attention = cached.view.attention.filter(item => item.id !== id);
  if (attention.length === cached.view.attention.length) return cached;
  const { needs_you } = cached.view.counts;
  const counts = { ...cached.view.counts, needs_you: needs_you.value === null ? needs_you : { ...needs_you, value: Math.max(0, needs_you.value - 1) } };
  return { ...cached, view: { ...cached.view, attention, counts } };
}

const isOverview = (principalId: string) => ({ queryKey }: { queryKey: QueryKey }) =>
  queryKey[0] === "aq" && queryKey[1] === principalId && queryKey[4] === "overview";

function applyOptimistic(client: QueryClient, principalId: string, id: string) {
  const filters = { predicate: isOverview(principalId) };
  return client.cancelQueries(filters).then(() => {
    const before = client.getQueriesData<Cached>(filters);
    client.setQueriesData<Cached>(filters, cached => cached && withoutItem(cached, id));
    return before;
  });
}

/**
 * Dismiss one Needs you item. The item leaves every cached overview (the list and the count) at
 * once; the overview is then re-read so the server's answer, not the guess, is what stays.
 * A refused dismissal (changed revision, undismissable kind) is not an error: the re-read shows the truth.
 * Only a failure that leaves the outcome unknown restores the row, and reports it.
 */
export function useDismissAttention() {
  const client = useQueryClient();
  const { bootstrap, queryContext } = useSession();
  const principalId = queryContext.principalId;
  const mutation = useMutation({
    mutationKey: DISMISS_KEY,
    mutationFn: ({ item }: { item: AttentionView }) => dismissAttention(item.id, item.subject.revision!),
    onMutate: ({ item }) => applyOptimistic(client, principalId, item.id),
    onError: (_error, _vars, before) => { for (const [key, data] of before ?? []) client.setQueryData(key, data); },
    onSettled: () => refreshOverview(client, principalId),
  });
  return { enabled: bootstrap.capability(ATTENTION_DISMISS).enabled, mutation };
}

/** True when the latest dismissal of this item failed with an unknown outcome (the row is back, the user may retry). */
export function useDismissFailed(id: string): boolean {
  const attempts = useMutationState({
    filters: { mutationKey: DISMISS_KEY },
    select: ({ state }) => ({ status: state.status, id: (state.variables as { item?: AttentionView } | undefined)?.item?.id, at: state.submittedAt }),
  }).filter(attempt => attempt.id === id);
  return attempts.sort((a, b) => b.at - a.at)[0]?.status === "error";
}
