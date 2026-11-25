import type { ComponentProps } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { apiGet } from "../../api/client";
import { adaptDecisions } from "../../api/adapters/decisions";
import { adaptHostDecisions, HOST_DECISIONS_ROOT } from "../../api/adapters/hostDecisions";
import { adaptQuestions, QUESTIONS_ROOT } from "../../api/adapters/questions";
import { queryKey } from "../../api/queryKeys";
import { PANEL_READ, useSession } from "../../app/session";
import type { DecisionInbox, InboxState } from "./DecisionInbox";

const ROOT = "/api/reviews/decisions";

function requestParams(state: InboxState, project?: string, cursor?: string | null) {
  const params = new URLSearchParams({ state, limit: "25" });
  if (project) params.set("project_id", project);
  if (cursor) params.set("cursor", cursor);
  return params;
}

function useInboxes(state: InboxState, project: string | undefined, offered: { reviews: boolean; questions: boolean; host: boolean }) {
  const { queryContext } = useSession();
  const inbox = useInfiniteQuery({
    queryKey: queryKey(queryContext, "decision-inbox", { project, state }), enabled: offered.reviews,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => { const q = requestParams(state, project, pageParam); return adaptDecisions(await apiGet(`${ROOT}?${q}`, signal), project); },
    getNextPageParam: (last, pages) => pages.length < 4 ? last.cursor ?? undefined : undefined,
  });
  const questions = useQuery({
    queryKey: queryKey(queryContext, "question-inbox", { project, state }), enabled: offered.questions,
    queryFn: async ({ signal }) => { const q = requestParams(state, project); return adaptQuestions(await apiGet(`${QUESTIONS_ROOT}?${q}`, signal), state === "open", project); },
  });
  const host = useQuery({
    queryKey: queryKey(queryContext, "host-decision-inbox", {}),
    enabled: offered.host,
    meta: PANEL_READ,
    queryFn: async ({ signal }) => adaptHostDecisions(await apiGet(HOST_DECISIONS_ROOT, signal)),
  });
  return { inbox, questions, host };
}

type Reads = ReturnType<typeof useInboxes>;
type Offered = Parameters<typeof useInboxes>[2];

function scopedHostRows(host: Reads["host"], enabled: boolean, project?: string) {
  if (!enabled || host.isError) return;
  return project ? host.data?.filter(row => row.projectId === project) : host.data;
}

function questionCount(questions: Reads["questions"], enabled: boolean) {
  if (!enabled || questions.isError) return 0;
  return questions.data?.items.length ?? 0;
}

function inboxContent({ inbox, questions, host }: Reads, offered: Offered, project?: string) {
  const rows = inbox.data?.pages.flatMap(page => page.items) ?? [];
  const unique = [...new Map(rows.map(row => [row.decisionId, row])).values()];
  const hostRows = scopedHostRows(host, offered.host, project);
  const asked = questionCount(questions, offered.questions);
  const hasReviews = Boolean(offered.reviews && inbox.data && !inbox.isError);
  const shown = (hasReviews ? unique.length : 0) + asked + (hostRows?.length ?? 0);
  return { rows: inbox.data ? unique : undefined, hostRows, hasReviews, shown };
}

function reportedError(read: { isError: boolean; error: unknown }) {
  return read.isError ? read.error : undefined;
}

function questionRows(read: Reads["questions"], enabled: boolean) {
  if (!enabled) return;
  const data = read.data;
  return { rows: data?.items, error: reportedError(read), more: Boolean(data?.cursor),
    serverTime: data?.serverTime, updatedAt: read.dataUpdatedAt };
}

function reviewPagination(inbox: Reads["inbox"]) {
  const pages = inbox.data?.pages ?? [];
  return {
    available: inbox.hasNextPage, loading: inbox.isFetchingNextPage, load: () => void inbox.fetchNextPage(),
    limitReached: pages.length === 4 && !!pages[3]?.cursor,
  };
}

function refreshInboxes({ inbox, questions, host }: Reads, offered: Offered) {
  if (offered.reviews) void inbox.refetch();
  if (offered.questions) void questions.refetch();
  if (offered.host) void host.refetch();
}

function decisionInboxProps(reads: Reads, offered: Offered, content: ReturnType<typeof inboxContent>) {
  const { inbox, questions, host } = reads;
  const onRefresh = () => refreshInboxes(reads, offered);
  const last = inbox.data?.pages.at(-1);
  return {
    rows: inbox.isError ? undefined : content.rows, error: reportedError(inbox),
    reviewsOffered: offered.reviews, serverTime: last?.serverTime, updatedAt: inbox.dataUpdatedAt,
    fetching: inbox.isFetching || questions.isFetching || host.isFetching, onRefresh,
    questions: questionRows(questions, offered.questions),
    host: offered.host ? { rows: content.hostRows, error: reportedError(host) } : undefined,
    more: reviewPagination(inbox),
  } satisfies Partial<ComponentProps<typeof DecisionInbox>>;
}

export function useDecisionInboxes(state: InboxState, project: string | undefined, offered: Offered) {
  const reads = useInboxes(state, project, offered);
  const content = inboxContent(reads, offered, project);
  return { content, inbox: decisionInboxProps(reads, offered, content) };
}
