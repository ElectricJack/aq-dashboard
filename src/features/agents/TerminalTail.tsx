import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { adaptTerminalInfo, adaptTerminalTail, adaptWatch, literalTail } from "../../api/adapters/terminalTail";
import { terminalJson } from "../../api/terminalClient";
import { queryKey } from "../../api/queryKeys";
import { useSession } from "../../app/session";
import styles from "./TerminalTail.module.css";
import { ActionButton } from "../../components/layout/Workspace";

const MAX_RETAINED = 65536;
/** Volatile literal bytes only: no screen renderer, capture, input, or persistence. */
export function TerminalTail({ terminalId }: { terminalId: string }) {
  const { queryContext: c } = useSession();
  return <Tail key={`${terminalId}:${c.principalId}:${c.authorizationRevision}:${c.contractVersion}`} terminalId={terminalId} />;
}
function Tail({ terminalId }: { terminalId: string }) {
  const { queryContext } = useSession();
  const client = useQueryClient();
  const [status, setStatus] = useState("Not watching");
  const [text, setText] = useState("");
  const [gaps, setGaps] = useState(0);
  const [trimmed, setTrimmed] = useState(false);
  const [active, setActive] = useState(false);
  const job = useRef<AbortController | null>(null);
  useEffect(() => () => { job.current?.abort(); }, []);

  async function watch() {
    job.current?.abort();
    const owner = new AbortController(); job.current = owner;
    const { signal } = owner;
    setText(""); setGaps(0); setTrimmed(false); setActive(true); setStatus("Subscribing…");
    let bytes: number[] = [];
    const watchJob = crypto.randomUUID();
    const path = `/api/v1/terminals/${encodeURIComponent(terminalId)}`;
    // Keys participate in SessionProvider's current-auth failure/cache fence.
    const read = (part: string, fetcher: () => ReturnType<typeof terminalJson>) => client.fetchQuery({
      queryKey: queryKey(queryContext, "terminal-tail", { terminalId, part, watchJob }), queryFn: fetcher, retry: false, staleTime: 0, gcTime: 0,
    });
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const started = performance.now();
      const inspected = await read("identity", () => terminalJson(path, signal));
      const info = adaptTerminalInfo(inspected.body, terminalId);
      if (signal.aborted) return;
      const operation = crypto.randomUUID();
      const requestedUntil = inspected.serverTime + 15000;
      if (!Number.isSafeInteger(requestedUntil) || performance.now() - started >= 15000) throw new Error("Inspect anchor expired");
      const watched = await read("watch", () => terminalJson(`${path}/mutations`, signal, { kind: "watch", body: {
        terminal: info.terminal, operation_id: operation, expected_session_revision: info.session_revision,
        expires_at_ms: requestedUntil, after_sequence: 0,
      } }));
      const subscription = adaptWatch(watched.body, info.terminal, operation);
      if (subscription.expires_at_ms > requestedUntil || subscription.expires_at_ms <= watched.serverTime || watched.serverTime < inspected.serverTime) throw new Error("Watch expiry changed");
      if (signal.aborted) return;
      // Monotonic local ceiling never extends the original 15s Watch intent.
      const duration = Math.max(0, subscription.expires_at_ms - inspected.serverTime - (performance.now() - started));
      if (duration <= 0) throw new Error("Watch already expired");
      expiryTimer = setTimeout(() => { if (job.current === owner) { setText(""); setStatus("Watch expired — output cleared"); setActive(false); owner.abort(); } }, duration);
      let after = 0;
      while (!signal.aborted) {
        const raw = await read("tail", () => terminalJson(`${path}/tail?subscription_id=${encodeURIComponent(subscription.subscription_id)}&after_sequence=${after}`, signal));
        const tail = await adaptTerminalTail(raw.body, info.terminal, subscription.subscription_id, after);
        if (signal.aborted) return;
        if (tail.server_time_ms !== raw.serverTime) throw new Error("Response clock mismatch");
        if (tail.session_revision !== subscription.session_revision || tail.expires_at_ms !== subscription.expires_at_ms) throw new Error("Watch binding changed");
        if (tail.availability === "not_retained") { bytes = []; setText(""); setStatus("Output not retained in this daemon runtime"); }
        else {
          // Gaps break byte continuity, including incomplete UTF-8 fragments.
          const newGaps = tail.gaps.filter(g => g.last_missing > after);
          const gapThrough = Math.max(0, ...newGaps.map(g => g.last_missing));
          if (newGaps.length) { bytes = []; setGaps(n => Math.min(1000000, n + newGaps.length)); }
          let previous = Math.max(after, gapThrough);
          for (const frame of tail.frames) if (frame.sequence > gapThrough) {
            if (previous > 0 && frame.sequence > previous + 1) { bytes = []; setGaps(n => Math.min(1000000, n + 1)); }
            bytes = bytes.concat(frame.bytes); previous = frame.sequence;
          }
          if (bytes.length > MAX_RETAINED) { bytes = bytes.slice(-MAX_RETAINED); setTrimmed(true); }
          setText(literalTail(bytes));
          setStatus(tail.disconnected ? "Disconnected — showing incomplete resident output" : "Watching incomplete resident output");
        }
        after = tail.next_sequence;
        // Even backlog reads are paced; no busy loop or unbounded browser queue.
        await new Promise<void>(resolve => { const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
          const timer = setTimeout(finish, tail.more ? 250 : 1000);
          signal.addEventListener("abort", finish, { once: true }); });
      }
    } catch (e) {
      if (!signal.aborted) { setText(""); setStatus("Output unavailable — access, subscription, or connection changed"); }
    } finally {
      if (expiryTimer !== undefined) clearTimeout(expiryTimer);
      if (job.current === owner) setActive(false);
    }
  }
  return <section className={styles.panel} aria-label="Read-only output tail">
    <h3>Output tail</h3>
    <p><span className={styles.fullCoverage}>Incomplete literal output only. Earlier bytes may be missing. This is not a terminal screen or snapshot.</span><span className={styles.compactCoverage}>Literal output · coverage incomplete</span></p>
    <p role="status">{status}</p>
    {gaps > 0 && <p>Output gaps or sequence discontinuities ({gaps}); preceding text was cleared.</p>}
    {trimmed && <p>Older browser output discarded at the 64 KiB limit.</p>}
    <pre className={styles.output} aria-label="Literal worker output">{text || "No output bytes available"}</pre>
    {!active && <ActionButton onClick={() => void watch()}>Watch output for up to 15 seconds</ActionButton>}
    {active && <ActionButton onClick={() => { job.current?.abort(); setText(""); setActive(false); setStatus("Watch stopped — output cleared"); }}>Stop watching</ActionButton>}
  </section>;
}
