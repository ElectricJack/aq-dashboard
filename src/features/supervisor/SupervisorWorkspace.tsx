import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MessageSquare } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { useSession } from "../../app/session";
import {useDraft} from "../../app/useDraft";
import {SupervisorControls,useSupervisors,validSupervisorScope} from "./SupervisorControls";
import { SupervisorConversation } from "./SupervisorConversation";
import styles from "./SupervisorConversation.module.css";
import { PageHeaderActionContext } from "../../components/layout/PageHeader";

/** One mounted conversation owns messages, immutable sends, draft and reading position. */
export function SupervisorWorkspace({ children }: { children: ReactNode }) {
  const location = useLocation(), navigate = useNavigate();
  const { queryContext } = useSession();
  const full = location.pathname === "/supervisor";
  const [opened, setOpened] = useState(full), [dock, setDock] = useState(false);
  const [savedScope,setSavedScope]=useDraft("supervisor-selected","global",validSupervisorScope);
  const routeScope=new URLSearchParams(location.search).get("supervisor");
  const scope=full&&validSupervisorScope(routeScope)?routeScope:savedScope;
  useEffect(()=>{if(full&&validSupervisorScope(routeScope)&&routeScope!==savedScope)setSavedScope(routeScope);},[full,routeScope,savedScope,setSavedScope]);
  const supervisors=useSupervisors(opened||full);
  const selected=supervisors.data?.supervisors.find(s=>scope==='global'?s.project_id===null:s.project_id===scope.slice(8));
  function selectScope(next:string){setSavedScope(next);if(full){const search=new URLSearchParams(location.search);search.set('supervisor',next);search.delete('operation');search.delete('message');void navigate({pathname:'/supervisor',search:search.toString()});}}
  const management=<SupervisorControls fleet={supervisors.data} selected={selected} scope={scope} onScope={selectScope} onChanged={()=>supervisors.refetch()}/>;
  const runtimeAvailable=selected?selected.enabled&&!['unavailable','failed','uncertain','stopped','stopping'].includes(selected.phase):scope==='global'?undefined:false;
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
  return <PageHeaderActionContext value={!full && !dock ? <button ref={launcher} className={styles.launcher} aria-label="Open supervisor" title="Open supervisor" type="button" onClick={() => { remember(); setOpened(true); if (desktop) { focusDock.current = true; setDock(true); } else void navigate("/supervisor"); }}><MessageSquare size={18} aria-hidden /><span className={styles.launcherText}>Open supervisor</span></button> : null}><div ref={surfaces} className={styles.surfaces} data-docked={docked || undefined} data-agents-compact={location.pathname === "/agents" || undefined}>
    {/* In normal flow above the page, never floating over page content (gap SV-E). */}
    <div className={styles.destination} data-supervisor-destination="" hidden={full}>{children}</div>
    <div ref={presentation} className={styles.presentation} hidden={!full && !(dock && desktop)} data-mode={full ? "full" : "dock"}>
      {(opened || full) && <SupervisorConversation key={`${queryContext.principalId}:${queryContext.authorizationRevision}:${queryContext.contractVersion}:${scope}`} projectId={scope==='global'?null:scope.slice(8)} label={selected?.label} management={management} runtimeAvailable={runtimeAvailable} presentation={full ? "full" : "dock"} visible={full || dock && desktop} controls={full ? <>
        {desktop ? <button type="button" className={styles.presentationButton} onClick={() => { setOpened(true); setDock(true); void navigate(returnTo.current); }}>Dock chat</button> : returnable && <button type="button" className={styles.presentationButton} onClick={() => void navigate(returnTo.current)}>Back</button>}
      </> : <>
        <button type="button" className={styles.presentationButton} aria-label="Expand conversation" onClick={() => { remember(false); void navigate("/supervisor"); }}><span className={styles.fullControl}>Expand conversation</span><span className={styles.compactControl} aria-hidden="true">↗</span></button>
        <button type="button" className={styles.presentationButton} aria-label="Close chat" onClick={close}><span className={styles.fullControl}>Close chat</span><span className={styles.compactControl} aria-hidden="true">×</span></button>
      </>} />}
    </div>
  </div></PageHeaderActionContext>;
}
