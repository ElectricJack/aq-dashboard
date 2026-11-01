import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { adaptSupervisorDiscovery, adaptSupervisorHistory, adaptSupervisorReceipt, freezeSupervisorMessage, mergeSupervisorMessages, supervisorId, validateSupervisorText,
  type FrozenSupervisorMessage, type Receipt, type SupervisorMessage } from "../../api/adapters/supervisor";
import { supervisorRequest } from "../../api/supervisorClient";
import { queryKey } from "../../api/queryKeys";
import { ApiError } from "../../api/client";
import { ContractError } from "../../api/adapters/contract";
import { useSession } from "../../app/session";
import { PageTitle } from "../../app/DestinationPage";
import { ActionButton } from "../../components/layout/Workspace";
import styles from "./SupervisorConversation.module.css";

const MAX_LOADED = 64;
export function SupervisorConversation() {
  const { bootstrap, queryContext } = useSession();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const operationParam = params.get("operation"), messageParam = params.get("message");
  const [draft, setDraft] = useState("");
  const [frozen, setFrozen] = useState<FrozenSupervisorMessage | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [sending, setSending] = useState(false), [sendError, setSendError] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupervisorMessage[]>([]);
  const [older, setOlder] = useState<string | null>(null), [historyBusy, setHistoryBusy] = useState(false), [historyError, setHistoryError] = useState(false);
  const [loaded, setLoaded] = useState(false), [newAvailable, setNewAvailable] = useState(false);
  const active = useRef(true), busy = useRef(false), historyBusyRef = useRef(false), pending = useRef<FrozenSupervisorMessage | null>(null);
  const jobs = useRef(new Set<AbortController>()), ticket = useRef(0), ownReference = useRef(":"), anchoredId = useRef<string | null>(null);
  const sendJob = useRef<AbortController | null>(null);
  const composing = useRef(false);
  const workspace = useRef<HTMLElement>(null);
  const history = useRef<HTMLDivElement>(null), atBottom = useRef(true), end = useRef<HTMLDivElement>(null);
  const discovery = useQuery({ queryKey: queryKey(queryContext, "supervisor-global", {}), retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      const value = adaptSupervisorDiscovery(await supervisorRequest("GET", "/api/human/conversations/global", signal));
      if (anchoredId.current && anchoredId.current !== value.conversation.id) throw new ContractError("Global conversation identity changed");
      anchoredId.current = value.conversation.id; return value;
    } });
  const conversation = discovery.data?.conversation;
  const canSend = bootstrap.capability("supervisor.message.enqueue").enabled && !discovery.isError;
  const operation = frozen?.operation ?? operationParam;
  const settled = receipt !== null;
  useEffect(() => { active.current = true; return () => { active.current = false; ticket.current++; for (const job of jobs.current) job.abort(); pending.current = null; }; }, []);
  useLayoutEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const measure = () => {
      const viewport = window.visualViewport;
      const available = Math.max(0, (viewport?.height ?? window.innerHeight) - Math.max(0, element.getBoundingClientRect().top - (viewport?.offsetTop ?? 0)));
      const value = `${Math.floor(available)}px`;
      if (element.style.getPropertyValue("--conversation-available-height") !== value) element.style.setProperty("--conversation-available-height", value);
    };
    measure(); window.addEventListener("resize", measure); window.visualViewport?.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    for (const parent of [element.parentElement, element.parentElement?.parentElement]) if (parent) observer?.observe(parent);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); window.visualViewport?.removeEventListener("resize", measure); };
  }, []);
  function operationUrl(op?: string, message?: string) {
    setParams(previous => { const next = new URLSearchParams(previous); if (op && message) { next.set("operation", op); next.set("message", message); } else { next.delete("operation"); next.delete("message"); } return next; }, { replace: true });
  }
  async function load(mode: "latest" | "older" | "new") {
    if (!conversation || historyBusyRef.current) return;
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
      if (mode === "new" && !atBottom.current && merged.length > MAX_LOADED) { setNewAvailable(true); return; }
      setMessages(merged.slice(-MAX_LOADED)); setLoaded(true);
      if (mode !== "new") setOlder(value.next_cursor);
      if (mode === "new" && (value.items.length > 0 || value.has_more)) setNewAvailable(!atBottom.current || value.has_more);
      requestAnimationFrame(() => {
        if (!active.current) return;
        if (mode === "older" && history.current) history.current.scrollTop += history.current.scrollHeight - scrollHeight;
        else if (mode === "latest" || atBottom.current) end.current?.scrollIntoView?.({ block: "nearest" });
      });
    } catch { if (active.current && !owner.signal.aborted) setHistoryError(true); }
    finally { jobs.current.delete(owner); historyBusyRef.current = false; if (active.current) setHistoryBusy(false); }
  }
  useEffect(() => { if (conversation) void load("latest"); }, [conversation?.id]);
  async function execute(kind: "post" | "lookup", op: string, message: string, intent?: FrozenSupervisorMessage) {
    if (!conversation || !supervisorId(op) || !supervisorId(message)) { setSendError("The retained operation reference is unavailable."); setSending(false); busy.current = false; return; }
    const current = ++ticket.current, owner = new AbortController(); jobs.current.add(owner); sendJob.current = owner;
    setSendError(null);
    try {
      const value = await client.fetchQuery({ queryKey: queryKey(queryContext, "supervisor-operation", { conversation: conversation.id, operation: op, mode: kind, attempt: current }), retry: false, staleTime: 0, gcTime: 0,
        queryFn: async ({ signal }) => adaptSupervisorReceipt(await supervisorRequest(kind === "post" ? "POST" : "GET", `/api/human/conversations/${conversation.id}/${kind === "post" ? "messages" : `operations/${op}`}`, AbortSignal.any([signal, owner.signal]), kind === "post" ? intent?.bytes : undefined),
          { conversation: conversation.id, actor: queryContext.principalId, operation: op, message, frozen: intent }) });
      if (!active.current || current !== ticket.current) return;
      setReceipt(value);
      if (value.state === "queued") { setDraft(""); void load("new"); }
    } catch (error) {
      if (!active.current || current !== ticket.current) return;
      setReceipt(null);
      setSendError(error instanceof ApiError && error.status === 404 ? "No receipt is available yet. The original request may still finish; its status remains unknown." : "Message status is unknown. Keep this operation and check its status or retry the exact original request.");
    } finally { jobs.current.delete(owner); if (sendJob.current === owner) sendJob.current = null; if (active.current && current === ticket.current) { busy.current = false; setSending(false); } }
  }
  useLayoutEffect(() => {
    if (!conversation) return;
    const reference = `${operationParam ?? ""}:${messageParam ?? ""}`;
    if (ownReference.current === reference) return;
    ownReference.current = reference; ticket.current++; sendJob.current?.abort();
    pending.current = null; setFrozen(null); setReceipt(null); setDraft("");
    if (operationParam) { busy.current = true; setSending(true); void execute("lookup", operationParam, messageParam ?? ""); }
    else { busy.current = false; setSending(false); setSendError(null); }
  }, [operationParam, messageParam, conversation?.id]);
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
    void execute(kind, operation, frozen?.message ?? messageParam ?? "", pending.current ?? undefined);
  }
  function another() {
    if (!settled || busy.current) return;
    pending.current = null; ownReference.current = ":"; setFrozen(null); setReceipt(null); setSendError(null); operationUrl(); void discovery.refetch();
  }
  return <section ref={workspace} className={styles.workspace} aria-label="Global supervisor conversation">
    <header className={styles.header}><div><PageTitle>Global supervisor</PageTitle><p>Global conversation · All projects</p></div><ActionButton aria-label="Refresh history" disabled={!conversation || historyBusy} onClick={() => void load("new")}><span className={styles.fullControl}>Refresh history</span><span className={styles.compactControl} aria-hidden="true">↻</span></ActionButton></header>
    <p className={styles.runtime} role="note">Supervisor is not connected. Messages stay queued.</p>
    {discovery.isError && <p role="status">Global conversation unavailable. <ActionButton onClick={() => void discovery.refetch()}>Retry conversation</ActionButton></p>}
    <div ref={history} className={styles.history} aria-label="Conversation history" role="region" tabIndex={0} onScroll={() => { const e = history.current; if (e) atBottom.current = e.scrollHeight - e.scrollTop - e.clientHeight < 48; }}>
      {!loaded && !discovery.isError && <p role="status">Loading conversation history…</p>}
      {historyError && <p role="status">History could not be refreshed. <ActionButton disabled={historyBusy} onClick={() => void load(loaded ? "new" : "latest")}>Retry history</ActionButton></p>}
      {older && <ActionButton disabled={historyBusy || messages.length >= MAX_LOADED} onClick={() => void load("older")}>Load older messages</ActionButton>}
      {messages.length >= MAX_LOADED && <p>Showing up to 64 loaded messages. <ActionButton disabled={historyBusy} onClick={() => void load("latest")}>Show latest messages</ActionButton></p>}
      {loaded && !historyError && messages.length === 0 && <p className={styles.empty}>No messages have been admitted to this global conversation.</p>}
      <ol className={styles.messages} aria-label="Supervisor messages">{messages.map(message => <li key={message.message_id} className={styles.message} data-own={message.author.user_id === queryContext.principalId}>
        <p className={styles.body}>{message.body}</p><p className={styles.metadata}>{message.author.user_id === queryContext.principalId ? "You" : `Human ${message.author.user_id.slice(0, 8)}`} · <time dateTime={new Date(message.created_at_ms).toISOString()}>{new Date(message.created_at_ms).toISOString()}</time> · Queued · Delivery not attempted</p>
      </li>)}</ol><div ref={end} />
    </div>
    {newAvailable && <ActionButton onClick={() => { setNewAvailable(false); atBottom.current = true; void load("latest"); }}>New messages available · Show latest</ActionButton>}
    <form className={styles.composer} onSubmit={event => void send(event)}>
      <label htmlFor="global-supervisor-message">Message the global supervisor</label>
      <textarea id="global-supervisor-message" value={draft} readOnly={!!operation || sending} rows={3} placeholder="Message the global supervisor…" onChange={event => setDraft(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current && event.keyCode !== 229 && !event.repeat && window.matchMedia?.("(pointer: fine)")?.matches) { event.preventDefault(); void send(); }
      }} />
      <div className={styles.composerActions}><span><span className={styles.fullControl}>Text only · no attachments or context</span><span className={styles.compactControl}>Text only</span></span><ActionButton aria-label={sending ? "Sending…" : "Send message"} type="submit" disabled={!conversation || !canSend || !!operation || sending || !draft.trim()}>{sending ? "Sending…" : <><span className={styles.fullControl}>Send message</span><span className={styles.compactControl}>Send</span></>}</ActionButton></div>
      {!canSend && <p role="status">Message enqueue is unavailable. Your draft is preserved.</p>}
      {sendError && <p role="status">{sendError}</p>}
      {receipt && <p role="status">{receipt.state === "queued" ? "Queued in the global mailbox. Delivery has not been attempted." : receipt.reason === "conversation_revision_changed" ? "Not queued: the conversation revision changed. Revise before sending a new request." : "Not queued: this message ID is already reserved."}</p>}
      {operation && <div className={styles.recovery}>
        <small>Operation {operation}</small>
        <ActionButton disabled={sending} onClick={() => retry("lookup")}>Check message status</ActionButton>
        {!receipt && frozen && <ActionButton disabled={sending || !canSend} onClick={() => retry("post")}>Retry exact message</ActionButton>}
        {!receipt && !frozen && <small>The original request body is no longer held here. Status lookup does not send a new message.</small>}
        {settled && <ActionButton disabled={sending} onClick={another}>{receipt.state === "queued" ? "Compose another message" : "Revise message"}</ActionButton>}
      </div>}
    </form>
  </section>;
}
