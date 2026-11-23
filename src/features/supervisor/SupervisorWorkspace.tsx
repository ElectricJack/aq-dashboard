import { useEffect, useRef, useState, type ReactNode } from "react";
import { MessageSquare } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { useSession } from "../../app/session";
import { useDraft } from "../../app/useDraft";
import { SupervisorControls, useSupervisors, validSupervisorScope } from "./SupervisorControls";
import { SupervisorConversation } from "./SupervisorConversation";
import { useDockFocus, useDockOffset } from "./useSupervisorDock";
import styles from "./SupervisorConversation.module.css";
import { PageHeaderActionContext } from "../../components/layout/PageHeader";
const unavailablePhases = new Set(["unavailable", "failed", "uncertain", "stopped", "stopping"]);
type Supervisor = NonNullable<ReturnType<typeof useSupervisors>["data"]>["supervisors"][number];
function supervisorAvailability(selected: Supervisor | undefined, projectId: string | null) {
  if (selected) return selected.enabled && !unavailablePhases.has(selected.phase);
  return projectId === null ? undefined : false;
}
function useConversationScope(opened: boolean, full: boolean) {
  const location = useLocation(),
    navigate = useNavigate();
  const [savedScope, setSavedScope] = useDraft("supervisor-selected", "global", validSupervisorScope);
  const routeScope = new URLSearchParams(location.search).get("supervisor");
  const routed = full && validSupervisorScope(routeScope) ? routeScope : undefined;
  const scope = routed ?? savedScope;
  useEffect(() => {
    if (routed && routed !== savedScope) setSavedScope(routed);
  }, [routed,savedScope,setSavedScope]);
  const supervisors = useSupervisors(opened);
  const projectId = scope === "global" ? null : scope.slice(8);
  const selected = supervisors.data?.supervisors.find(supervisor => supervisor.project_id === projectId);
  function selectScope(next: string) {
    setSavedScope(next);
    if (full) {
      const search = new URLSearchParams(location.search);
      search.set("supervisor", next);
      search.delete("operation");
      search.delete("message");
      void navigate({ pathname: "/supervisor", search: search.toString() });
    }
  }
  const management = (
    <SupervisorControls
      fleet={supervisors.data}
      selected={selected}
      scope={scope}
      onScope={selectScope}
      onChanged={() => supervisors.refetch()}
    />
  );
  const runtimeAvailable = supervisorAvailability(selected, projectId);
  return { scope, projectId, label: selected?.label, management, runtimeAvailable };
}

function usePresentation() {
  const location = useLocation(),
    navigate = useNavigate();
  const full = location.pathname === "/supervisor";
  const [opened, setOpened] = useState(full),
    [dock, setDock] = useState(false);
  const [desktop, setDesktop] = useState(() => window.innerWidth >= 1200);
  const returnTo = useRef("/overview");
  // Back belongs only to a full page opened from another view (launcher, dock, expand).
  // A direct or bottom-nav visit to the primary destination has no return location.
  const [returnable, setReturnable] = useState(false);
  useEffect(() => {
    if (!full) setReturnable(false);
  }, [full]);
  const returnFocus = useRef<HTMLElement | null>(null),
    launcher = useRef<HTMLButtonElement>(null);

  const docked = dock && desktop && !full;
  const { focusDock, presentation } = useDockFocus(docked);
  useEffect(() => {
    if (full) setOpened(true);
  }, [full]);
  useEffect(() => {
    const resize = () => setDesktop(window.innerWidth >= 1200);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    if (dock && !desktop && !full) {
      setDock(false);
      setReturnable(true);
      void navigate("/supervisor");
    }
  }, [dock, desktop, full, navigate]);
  const remember = (focus = true) => {
    if (!full) {
      returnTo.current = location.pathname + location.search + location.hash;
      setReturnable(true);
    }
    if (focus)
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const close = () => {
    setDock(false);
    requestAnimationFrame(() =>
      (returnFocus.current?.isConnected ? returnFocus.current : launcher.current)?.focus(),
    );
  };

  function open() {
    remember();
    setOpened(true);
    if (desktop) {
      focusDock.current = true;
      setDock(true);
    } else void navigate("/supervisor");
  }
  function dockChat() {
    setOpened(true);
    setDock(true);
    void navigate(returnTo.current);
  }
  function back() {
    void navigate(returnTo.current);
  }
  function expand() {
    remember(false);
    void navigate("/supervisor");
  }
  return {
    full,
    desktop,
    docked,
    launcher,
    presentation,
    opened: opened || full,
    visible: full || docked,
    showLauncher: !full && !dock,
    returnable,
    open,
    close,
    back,
    dockChat,
    expand,
  };
}
type Presentation = ReturnType<typeof usePresentation>;

function ConversationControls({ view }: { view: Presentation }) {
  if (view.full) {
    if (view.desktop)
      return (
        <button type="button" className={styles.presentationButton} onClick={view.dockChat}>
          Dock chat
        </button>
      );
    if (view.returnable)
      return (
        <button type="button" className={styles.presentationButton} onClick={view.back}>
          Back
        </button>
      );
    return null;
  }
  return (
    <>
      <button
        type="button"
        className={styles.presentationButton}
        aria-label="Expand conversation"
        onClick={view.expand}
      >
        <span className={styles.fullControl}>Expand conversation</span>
        <span className={styles.compactControl} aria-hidden="true">
          ↗
        </span>
      </button>
      <button
        type="button"
        className={styles.presentationButton}
        aria-label="Close chat"
        onClick={view.close}
      >
        <span className={styles.fullControl}>Close chat</span>
        <span className={styles.compactControl} aria-hidden="true">
          ×
        </span>
      </button>
    </>
  );
}
const compactRoutes = new Set(["/agents", "/agents/swarm", "/agents/history"]);
/** One mounted conversation owns messages, immutable sends, draft and reading position. */
export function SupervisorWorkspace({ children }: { children: ReactNode }) {
  const view = usePresentation();
  const { queryContext } = useSession();
  const { pathname } = useLocation();
  const { scope, ...conversation } = useConversationScope(view.opened, view.full);
  const surfaces = useDockOffset(view.docked);
  const mode = view.full ? "full" : "dock";
  const launcher = view.showLauncher ? (
    <button
      ref={view.launcher}
      className={styles.launcher}
      aria-label="Open supervisor"
      title="Open supervisor"
      type="button"
      onClick={view.open}
    >
      <MessageSquare size={18} aria-hidden />
      <span className={styles.launcherText}>Open supervisor</span>
    </button>
  ) : null;
  return (
    <PageHeaderActionContext value={launcher}>
      <div
        ref={surfaces}
        className={styles.surfaces}
        data-docked={view.docked || undefined}
        data-agents-compact={compactRoutes.has(pathname) || undefined}
      >
        <div className={styles.destination} data-supervisor-destination="" hidden={view.full}>
          {children}
        </div>
        <div ref={view.presentation} className={styles.presentation} hidden={!view.visible} data-mode={mode}>
          {view.opened && (
            <SupervisorConversation
              key={`${queryContext.principalId}:${queryContext.authorizationRevision}:${queryContext.contractVersion}:${scope}`}
              {...conversation}
              presentation={mode}
              visible={view.visible}
              controls={<ConversationControls view={view} />}
            />
          )}
        </div>
      </div>
    </PageHeaderActionContext>
  );
}
