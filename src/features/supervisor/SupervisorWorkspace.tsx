import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  // Back belongs only to a full page opened from another view (launcher, dock, expand).
  // A direct or bottom-nav visit to the primary destination has no return location.
  const [returnable, setReturnable] = useState(false);
  useEffect(() => { if (!full) setReturnable(false); }, [full]);
  const returnFocus = useRef<HTMLElement | null>(null), launcher = useRef<HTMLButtonElement>(null);
  const surfaces = useRef<HTMLDivElement>(null), presentation = useRef<HTMLDivElement>(null), focusDock = useRef(false);
  const docked = dock && desktop && !full;
  // Opening the dock moves focus into it (the launcher it replaces unmounts): the
  // composer, else the dock heading (SO-14, ISSUE-007). Close returns it below.
  useEffect(() => {
    if (!docked || !focusDock.current) return;
    let frame = 0, tries = 0;
    const attempt = () => {
      const pane = presentation.current;
      const target = pane?.querySelector<HTMLElement>("textarea:not([disabled])") ?? pane?.querySelector<HTMLElement>("h2");
      if (target) { focusDock.current = false; if (target.tagName === "H2" && !target.hasAttribute("tabindex")) target.tabIndex = -1; target.focus(); }
      else if (++tries < 30) frame = requestAnimationFrame(attempt);
      else focusDock.current = false;
    };
    frame = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(frame);
  }, [docked]);
  useEffect(() => { if (full) setOpened(true); }, [full]);
  useEffect(() => {
    const resize = () => setDesktop(window.innerWidth >= 1200);
    window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    if (dock && !desktop && !full) { setDock(false); setReturnable(true); void navigate("/supervisor"); }
  }, [dock, desktop, full, navigate]);
  // The dock is an edge pane under the sticky header. The content area starts
  // at the header bottom, so its document offset is the dock's sticky top.
  useLayoutEffect(() => {
    const element = surfaces.current, main = element?.closest("main") ?? element?.parentElement;
    if (!docked || !element || !main) return;
    const measure = () => {
      const value = `${Math.max(0, Math.round(main.getBoundingClientRect().top + window.scrollY))}px`;
      if (element.style.getPropertyValue("--dock-top") !== value) element.style.setProperty("--dock-top", value);
    };
    measure(); window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (main.previousElementSibling) observer?.observe(main.previousElementSibling);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [docked]);
  const remember = (focus = true) => {
    if (!full) { returnTo.current = location.pathname + location.search + location.hash; setReturnable(true); }
    if (focus) returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const close = () => { setDock(false); requestAnimationFrame(() => (returnFocus.current?.isConnected ? returnFocus.current : launcher.current)?.focus()); };
  return <div ref={surfaces} className={styles.surfaces} data-docked={docked || undefined}>
    {/* In normal flow above the page, never floating over page content (gap SV-E). */}
    {!full && !dock && <div className={styles.launcherBar}><button ref={launcher} className={styles.launcher} type="button" onClick={() => { remember(); setOpened(true); if (desktop) { focusDock.current = true; setDock(true); } else void navigate("/supervisor"); }}>Open supervisor</button></div>}
    <div className={styles.destination} data-supervisor-destination="" hidden={full}>{children}</div>
    <div ref={presentation} className={styles.presentation} hidden={!full && !(dock && desktop)} data-mode={full ? "full" : "dock"}>
      {(opened || full) && <SupervisorConversation key={`${queryContext.principalId}:${queryContext.authorizationRevision}:${queryContext.contractVersion}`} presentation={full ? "full" : "dock"} visible={full || dock && desktop} controls={full ? <>
        {desktop ? <button type="button" className={styles.presentationButton} onClick={() => { setOpened(true); setDock(true); void navigate(returnTo.current); }}>Dock chat</button> : returnable && <button type="button" className={styles.presentationButton} onClick={() => void navigate(returnTo.current)}>Back</button>}
      </> : <>
        <button type="button" className={styles.presentationButton} aria-label="Expand conversation" onClick={() => { remember(false); void navigate("/supervisor"); }}><span className={styles.fullControl}>Expand conversation</span><span className={styles.compactControl} aria-hidden="true">↗</span></button>
        <button type="button" className={styles.presentationButton} aria-label="Close chat" onClick={close}><span className={styles.fullControl}>Close chat</span><span className={styles.compactControl} aria-hidden="true">×</span></button>
      </>} />}
    </div>
  </div>;
}
