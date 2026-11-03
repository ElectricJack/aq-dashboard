import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useLocation } from "react-router";
import { adaptSupervisorDiscovery, adaptSupervisorHistory, freezeSupervisorMessage, mergeSupervisorMessages, supervisorId, validateSupervisorText,
  type FrozenSupervisorMessage, type SupervisorMessage } from "../../api/adapters/supervisor";
import { supervisorRequest } from "../../api/supervisorClient";
import { queryKey } from "../../api/queryKeys";
import { supervisorAction, supervisorActionError } from "./supervisorAction";
import type { ActionOperation } from "../actions/actionClient";
import { ContractError } from "../../api/adapters/contract";
import { useSession } from "../../app/session";
import { useDraft } from "../../app/useDraft";
import { PageTitle } from "../../app/DestinationPage";
import { ActionButton } from "../../components/layout/Workspace";
import styles from "./SupervisorConversation.module.css";

const MAX_LOADED = 64;
const deliveryText = { not_attempted: "Delivery not attempted", pending: "Host delivery pending", delivery_unknown: "Delivery unknown · do not resend", delivered: "Delivered to supervisor host · work not confirmed", not_delivered: "Host delivery failed" };
const validDraft = (value: unknown): value is string => typeof value === "string";
export function SupervisorConversation({ presentation = "full", visible = true, controls }: { presentation?: "full" | "dock"; visible?: boolean; controls?: ReactNode }) {
  const { bootstrap, queryContext } = useSession();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const full = presentation === "full";
  const operationParam = params.get("operation"), messageParam = params.get("message");
  const [draft, setDraft] = useDraft("supervisor-global", "", validDraft);
  const [frozen, setFrozen] = useState<FrozenSupervisorMessage | null>(null);
  const [retained, setRetained] = useState<{ operation: string; message: string } | null>(null);
  const [receipt, setReceipt] = useState<ActionOperation | null>(null);
  const [sending, setSending] = useState(false), [sendError, setSendError] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupervisorMessage[]>([]);
  const [older, setOlder] = useState<string | null>(null), [historyBusy, setHistoryBusy] = useState(false), [historyError, setHistoryError] = useState(false);
  const [loaded, setLoaded] = useState(false), [newAvailable, setNewAvailable] = useState(false);
  const active = useRef(true), busy = useRef(false), historyBusyRef = useRef(false), pending = useRef<FrozenSupervisorMessage | null>(null);
  const jobs = useRef(new Set<AbortController>()), ticket = useRef(0), ownReference = useRef(":"), anchoredId = useRef<string | null>(null);
  const sendJob = useRef<AbortController | null>(null);
  const referenceLoaded = useRef(false);
  const composing = useRef(false);
  const workspace = useRef<HTMLElement>(null);
  const history = useRef<HTMLDivElement>(null), atBottom = useRef(true), prependHeight = useRef<number | null>(null);
  const historyAllowed = bootstrap.capability("supervisor.history.read").enabled;
  const available = bootstrap.globalSupervisor.status === "available" && bootstrap.capability("supervisor.conversation").enabled;
  const discovery = useQuery({ enabled: historyAllowed, queryKey: queryKey(queryContext, "supervisor-global", {}), retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      const value = adaptSupervisorDiscovery(await supervisorRequest("GET", "/api/human/conversations/global", signal));
      if (anchoredId.current && anchoredId.current !== value.conversation.id) throw new ContractError("Global conversation identity changed");
      anchoredId.current = value.conversation.id; return value;
    } });
  const conversation = discovery.data?.conversation;
  const canSend = available && historyAllowed && bootstrap.capability("dashboard.actions").enabled && bootstrap.capability("supervisor.message.enqueue").enabled && !discovery.isError;
  const operation = frozen?.operation ?? (full ? operationParam : retained?.operation);
  const settled = receipt !== null && ["confirmed", "conflict", "rejected"].includes(receipt.disposition);
  useEffect(() => { active.current = true; return () => { active.current = false; ticket.current++; for (const job of jobs.current) job.abort(); pending.current = null; }; }, []);
  useLayoutEffect(() => {
    const element = workspace.current;
    if (!element) return;
    // Only the dock measures; the full page fits the viewport through the shell's flex column.
    if (full) { element.style.removeProperty("--conversation-available-height"); return; }
    const measure = () => {
      const viewport = window.visualViewport;
      const available = Math.max(0, (viewport?.height ?? window.innerHeight) - Math.max(0, element.getBoundingClientRect().top - (viewport?.offsetTop ?? 0)));
      const value = `${Math.floor(available)}px`;
      if (element.style.getPropertyValue("--conversation-available-height") !== value) element.style.setProperty("--conversation-available-height", value);
    };
    measure(); window.addEventListener("resize", measure); window.visualViewport?.addEventListener("resize", measure); window.visualViewport?.addEventListener("scroll", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    for (const parent of [element.parentElement, element.parentElement?.parentElement]) if (parent) observer?.observe(parent);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); window.visualViewport?.removeEventListener("resize", measure); window.visualViewport?.removeEventListener("scroll", measure); };
  }, [presentation, visible]);
  // Scroll only after React commits the new rows, so initial history and pending
  // bubbles use their real height. Older pages preserve the reader's anchor.
  useLayoutEffect(() => {
    const region = history.current;
    if (!region) return;
    if (prependHeight.current !== null) { region.scrollTop += region.scrollHeight - prependHeight.current; prependHeight.current = null; }
    else if (atBottom.current) region.scrollTop = region.scrollHeight;
  }, [messages, frozen]);
  function operationUrl(op?: string, message?: string) {
    if (location.pathname !== "/supervisor") return;
    setParams(previous => { const next = new URLSearchParams(previous); if (op && message) { next.set("operation", op); next.set("message", message); } else { next.delete("operation"); next.delete("message"); } return next; }, { replace: true });
  }
  async function load(mode: "latest" | "older" | "new" | "refresh") {
    if (!conversation || !historyAllowed || historyBusyRef.current) return;
    historyBusyRef.current = true; setHistoryBusy(true); setHistoryError(false);
    const owner = new AbortController(); jobs.current.add(owner);
    const page = mode === "older" && older ? { before: older } : mode === "new" ? { after: messages.at(-1)?.cursor ?? "0" } : {};
    const search = new URLSearchParams({ limit: String(mode === "older" ? Math.min(16, MAX_LOADED - messages.length) : 16) });
    if (page.before) search.set("before", page.before);
    if (page.after !== undefined) search.set("after", page.after);
    const scrollHeight = history.current?.scrollHeight ?? 0;
    try {
      const value = await client.fetchQuery({ queryKey: queryKey(queryContext, "supervisor-history", { conversation, ...page }), retry: false, gcTime: 0, staleTime: 0,
        queryFn: async ({ signal }) => {
          const pageValue = await adaptSupervisorHistory(await supervisorRequest("GET", `/api/human/conversations/${conversation.id}/messages?${search}`, AbortSignal.any([signal, owner.signal])), conversation, page);
          return { ...pageValue, merged: mergeSupervisorMessages(mode === "latest" ? [] : messages, pageValue.items) };
        } });
      if (!active.current) return;
      const merged = value.merged;
      if ((mode === "new" || mode === "refresh") && !atBottom.current && merged.length > MAX_LOADED) { setNewAvailable(true); return; }
      if (mode === "older") prependHeight.current = scrollHeight;
      setMessages(merged.slice(-MAX_LOADED)); setLoaded(true);
      if (mode === "latest" || mode === "older") setOlder(value.next_cursor);
      if ((mode === "new" || mode === "refresh") && (merged.length > messages.length || mode === "new" && value.has_more)) setNewAvailable(!atBottom.current || value.has_more);

    } catch { if (active.current && !owner.signal.aborted) setHistoryError(true); }
    finally { jobs.current.delete(owner); historyBusyRef.current = false; if (active.current) setHistoryBusy(false); }
  }
  useEffect(() => { if (conversation) void load("latest"); }, [conversation?.id]);
  // Poll retained history, never re-send or reinject a message. Cursors include replies.
  useEffect(() => {
    if (!conversation || !visible || !available) return;
    const timer = window.setInterval(() => void load("refresh"), 2500);
    return () => window.clearInterval(timer);
  });
  async function execute(kind: "post" | "lookup", op: string, message: string, intent?: FrozenSupervisorMessage) {
    if (!conversation || !supervisorId(op) || !supervisorId(message)) { setSendError("The retained operation reference is unavailable."); setSending(false); busy.current = false; return; }
    const current = ++ticket.current, owner = new AbortController(); jobs.current.add(owner); sendJob.current = owner;
    setSendError(null);
    try {
      const value = await client.fetchQuery({ queryKey: queryKey(queryContext, "supervisor-operation", { conversation: conversation.id, operation: op, mode: kind, attempt: current }), retry: false, staleTime: 0, gcTime: 0,
        queryFn: ({ signal }) => supervisorAction(kind, conversation.id, op, message, AbortSignal.any([signal, owner.signal]), intent) });
      if (!active.current || current !== ticket.current) return;
      setReceipt(value);
      if (value.disposition === "confirmed") { setDraft(""); void load("new"); }
    } catch (error) {
      if (!active.current || current !== ticket.current) return;
      setReceipt(null);
      setSendError(supervisorActionError(error));
    } finally { jobs.current.delete(owner); if (sendJob.current === owner) sendJob.current = null; if (active.current && current === ticket.current) { busy.current = false; setSending(false); } }
  }
  useLayoutEffect(() => {
    if (!conversation || !full) return;
    if (!operationParam && (frozen || retained)) { operationUrl(frozen?.operation ?? retained!.operation, frozen?.message ?? retained!.message); return; }
    const reference = `${operationParam ?? ""}:${messageParam ?? ""}`;
    const initial = !referenceLoaded.current; referenceLoaded.current = true;
    if (ownReference.current === reference) return;
    setRetained(operationParam ? { operation: operationParam, message: messageParam ?? "" } : null);
    ownReference.current = reference; ticket.current++; sendJob.current?.abort();
    pending.current = null; setFrozen(null); setReceipt(null); if (!initial) setDraft("");
    if (operationParam) { busy.current = true; setSending(true); void execute("lookup", operationParam, messageParam ?? ""); }
    else { busy.current = false; setSending(false); setSendError(null); }
  }, [operationParam, messageParam, conversation?.id, full]);
  async function send(event?: FormEvent) {
    event?.preventDefault(); if (!conversation || !canSend || busy.current || operation) return;
    const invalid = validateSupervisorText(draft); if (invalid) { setSendError(invalid); return; }
    busy.current = true; setSending(true); const preparation = ticket.current;
    try {
      const intent = await freezeSupervisorMessage(conversation, queryContext.principalId, draft);
      if (!active.current || preparation !== ticket.current) return;
      pending.current = intent; ownReference.current = `${intent.operation}:${intent.message}`; setFrozen(intent); operationUrl(intent.operation, intent.message);
      await execute("post", intent.operation, intent.message, intent);
    } catch { if (active.current && preparation === ticket.current) { busy.current = false; setSending(false); setSendError("Could not prepare the message. Your draft is preserved."); } }
  }
  function retry(kind: "lookup" | "post") {
    if (busy.current || !operation || (kind === "post" && (!canSend || !pending.current))) return;
    busy.current = true; setSending(true);
    void execute(kind, operation, frozen?.message ?? (full ? messageParam : retained?.message) ?? "", pending.current ?? undefined);
  }
  useEffect(() => {
    if (!visible || receipt?.disposition !== "pending" || sending) return;
    const timer = window.setTimeout(() => retry("lookup"), 1500);
    return () => window.clearTimeout(timer);
  });
  function another() {
    if (!settled || busy.current) return;
    pending.current = null; setRetained(null); ownReference.current = ":"; setFrozen(null); setReceipt(null); setSendError(null); operationUrl(); void discovery.refetch();
  }
  return <section ref={workspace} className={styles.workspace} data-presentation={presentation} data-viewport-fit={full || undefined} aria-label="Global supervisor conversation">
    <header className={styles.header}><div>{full ? <PageTitle>Global supervisor</PageTitle> : <h2>Global supervisor</h2>}<p>Global conversation · All projects</p></div><div className={styles.headerActions}>{controls}<ActionButton aria-label="Refresh history" disabled={!conversation || !historyAllowed || historyBusy} onClick={() => void load("new")}><span className={styles.fullControl}>Refresh history</span><span className={styles.compactControl} aria-hidden="true">↻</span></ActionButton></div></header>
    {!available && <p className={styles.runtime} role="note">Supervisor is not connected. Conversation unavailable; your draft is preserved.</p>}
    {!historyAllowed && <p role="status">Supervisor history is unavailable.</p>}
    {discovery.isError && <p role="status">Global conversation unavailable. <ActionButton onClick={() => void discovery.refetch()}>Retry conversation</ActionButton></p>}
    <div ref={history} className={styles.history} aria-label="Conversation history" role="region" tabIndex={0} onScroll={() => { const e = history.current; if (e) atBottom.current = e.scrollHeight - e.scrollTop - e.clientHeight < 48; }}>
      {historyAllowed && !loaded && !discovery.isError && <p role="status">Loading conversation history…</p>}
      {historyError && <p role="status">History could not be refreshed. <ActionButton disabled={historyBusy} onClick={() => void load(loaded ? "new" : "latest")}>Retry history</ActionButton></p>}
      {older && <ActionButton disabled={historyBusy || messages.length >= MAX_LOADED} onClick={() => void load("older")}>Load older messages</ActionButton>}
      {messages.length >= MAX_LOADED && <p>Showing up to 64 loaded messages. <ActionButton disabled={historyBusy} onClick={() => { atBottom.current = true; void load("latest"); }}>Show latest messages</ActionButton></p>}
      {loaded && !historyError && messages.length === 0 && <p className={styles.empty}>No messages have been admitted to this global conversation.</p>}
      <ol className={styles.messages} aria-label="Supervisor messages">{messages.map(message => <li key={message.message_id} data-message-id={message.message_id} className={styles.message} data-own={message.author.kind === "human" && message.author.user_id === queryContext.principalId}>
        <p className={styles.body}>{message.body}</p><p className={styles.metadata}>{message.author.kind === "supervisor" ? "Supervisor" : message.author.user_id === queryContext.principalId ? "You" : `Human ${message.author.user_id.slice(0, 8)}`}<span className={styles.timestamp}> · <time title={new Date(message.created_at_ms).toISOString()} dateTime={new Date(message.created_at_ms).toISOString()}>{new Date(message.created_at_ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></span> · {message.author.kind === "supervisor" ? "Reply received" : `Queued · ${deliveryText[message.host_delivery]}`}</p>
      </li>)}</ol>
      {frozen && !messages.some(item => item.message_id === frozen.message) && <div className={styles.pending} data-message-id={frozen.message}><p className={styles.body}>{JSON.parse(frozen.bytes).body}</p><p role="status">{sending ? "Sending · awaiting admission" : receipt?.disposition === "confirmed" ? "Queued · awaiting history" : receipt?.disposition === "pending" ? "Admission pending" : settled ? "Not queued" : "Admission unknown"}</p></div>}
    </div>
    {newAvailable && <ActionButton onClick={() => { setNewAvailable(false); atBottom.current = true; void load("latest"); }}>New messages available · Show latest</ActionButton>}
    <form className={styles.composer} onSubmit={event => void send(event)}>
      <label htmlFor="global-supervisor-message">Message the global supervisor</label>
      <textarea id="global-supervisor-message" value={draft} readOnly={!!operation || sending} rows={3} placeholder="Message the global supervisor…" onChange={event => setDraft(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current && event.keyCode !== 229 && !event.repeat && window.matchMedia?.("(pointer: fine)")?.matches) { event.preventDefault(); void send(); }
      }} />
      <div className={styles.composerActions}><span><span className={styles.fullControl}>Text only · no attachments or context</span><span className={styles.compactControl}>Text only</span></span><ActionButton aria-label={sending ? "Sending…" : "Send message"} type="submit" disabled={!conversation || !canSend || !!operation || sending || !draft.trim()}>{sending ? "Sending…" : <><span className={styles.fullControl}>Send message</span><span className={styles.compactControl}>Send</span></>}</ActionButton></div>
      {!canSend && <p role="status">Sending is unavailable. Your draft is preserved.</p>}
      {sendError && <p role="status">{sendError}</p>}
      {receipt && <p role="status">{receipt.disposition === "confirmed" ? "Queued in the global mailbox. This acknowledgement does not confirm delivery or completed work." : receipt.disposition === "conflict" ? "Not queued: the conversation revision changed. Revise before sending a new request." : receipt.disposition === "pending" ? "Admission pending. Check message status; no delivery is confirmed." : receipt.disposition === "unknown" ? "Admission unknown. Check the original operation; no replacement is sent." : "Not queued: the request was rejected."}</p>}
      {operation && <div className={styles.recovery}>
        <small>Operation {operation}</small>
        <ActionButton disabled={sending} onClick={() => retry("lookup")}>Check message status</ActionButton>
        {!settled && receipt?.disposition !== "confirmed" && frozen && <ActionButton disabled={sending || !canSend} onClick={() => retry("post")}>Retry exact message</ActionButton>}
        {!settled && !frozen && <small>The original request body is no longer held here. Status lookup does not send a new message.</small>}
        {settled && <ActionButton disabled={sending} onClick={another}>{receipt.disposition === "confirmed" ? "Compose another message" : "Revise message"}</ActionButton>}
      </div>}

    </form>
  </section>;
}
