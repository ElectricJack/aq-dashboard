import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { useSession } from "../../app/session";
import { SupervisorConversation } from "./SupervisorConversation";
import styles from "./SupervisorConversation.module.css";

/** One mounted conversation owns messages, immutable sends, draft and reading position. */
export function SupervisorWorkspace({ children }: { children: ReactNode }) {
  const location = useLocation(), navigate = useNavigate();
  const { queryContext } = useSession();
  const full = location.pathname === "/supervisor";
  const [opened, setOpened] = useState(full), [dock, setDock] = useState(false);
  const [desktop, setDesktop] = useState(() => window.innerWidth >= 1200);
  const returnTo = useRef("/overview");
  const returnFocus = useRef<HTMLElement | null>(null), launcher = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (full) setOpened(true); }, [full]);
  useEffect(() => {
    const resize = () => setDesktop(window.innerWidth >= 1200);
    window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    if (dock && !desktop && !full) { setDock(false); void navigate("/supervisor"); }
  }, [dock, desktop, full, navigate]);
  const remember = (focus = true) => {
    if (!full) returnTo.current = location.pathname + location.search + location.hash;
    if (focus) returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const close = () => { setDock(false); requestAnimationFrame(() => (returnFocus.current?.isConnected ? returnFocus.current : launcher.current)?.focus()); };
  return <div className={styles.surfaces} data-docked={dock && desktop && !full || undefined}>
    {/* In normal flow above the page, never floating over page content (gap SV-E). */}
    {!full && !dock && <div className={styles.launcherBar}><button ref={launcher} className={styles.launcher} type="button" onClick={() => { remember(); setOpened(true); if (desktop) setDock(true); else void navigate("/supervisor"); }}>Open supervisor</button></div>}
    <div className={styles.destination} data-supervisor-destination="" hidden={full}>{children}</div>
    <div className={styles.presentation} hidden={!full && !(dock && desktop)} data-mode={full ? "full" : "dock"}>
      {(opened || full) && <SupervisorConversation key={`${queryContext.principalId}:${queryContext.authorizationRevision}:${queryContext.contractVersion}`} presentation={full ? "full" : "dock"} visible={full || dock && desktop} controls={full ? <>
        {desktop ? <button type="button" className={styles.presentationButton} onClick={() => { setOpened(true); setDock(true); void navigate(returnTo.current); }}>Dock chat</button> : <button type="button" className={styles.presentationButton} onClick={() => void navigate(returnTo.current)}>Back</button>}
      </> : <>
        <button type="button" className={styles.presentationButton} aria-label="Expand conversation" onClick={() => { remember(false); void navigate("/supervisor"); }}><span className={styles.fullControl}>Expand conversation</span><span className={styles.compactControl} aria-hidden="true">↗</span></button>
        <button type="button" className={styles.presentationButton} aria-label="Close chat" onClick={close}><span className={styles.fullControl}>Close chat</span><span className={styles.compactControl} aria-hidden="true">×</span></button>
      </>} />}
    </div>
  </div>;
}
