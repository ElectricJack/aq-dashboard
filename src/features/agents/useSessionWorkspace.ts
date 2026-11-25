import { useEffect, useId, useRef, useState } from "react";
import { useLocation } from "react-router";
import { adaptSessionDetail, type SessionDetailView } from "../../api/adapters/inspection";
import type { SessionDetail as SessionDetailWire } from "../../api/wire/proposed";
import { useScope } from "../../app/scope";
import { useSession } from "../../app/session";
import { useRead } from "../../app/useRead";
import { columnsForPane, MIN_PANE_COLUMNS } from "./InteractiveTerminal";
import { createOutputFeed } from "./TerminalTail";
import { ContractError } from "../../api/adapters/contract";
import { useMediaQuery } from "../../components/useMediaQuery";
import { type OperationsView } from "./operations/OperationsViews";
import { useSessionRoster } from "./SessionRoster";
import { type FocusState } from "./SessionSwitcher";

type DrawerKind = "details" | "transcript" | "message";

/** Workspace view (spec §6). Split is explicit and at most two panes; Expand hides page chrome. */
export type WorkspaceView = { layout: "focus" | "split"; expanded: boolean; secondId: string | null };
export type ViewChange = (change: Partial<WorkspaceView>) => void;
/** Divider between split panes (`.panes[data-split]` gap). */
const SPLIT_GAP_PX = 1;

/** Per-pane columns a split of the measured workspace would give; null until measured. */
function useSplitColumns(present: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!present || !el) return;
    const observer = new ResizeObserver(() =>
      setColumns(columnsForPane((el.getBoundingClientRect().width - SPLIT_GAP_PX) / 2)),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [present]);
  return [ref, columns] as const;
}

function useSessionDetail(sessionId: string) {
  const [scope] = useScope();
  return useRead<SessionDetailWire, SessionDetailView>({
    resource: "session",
    path: `/api/v1/sessions/${encodeURIComponent(sessionId)}`,
    scope,
    params: {},
    adapt: (wire, time) => {
      if (wire.id !== sessionId) throw new ContractError("Session detail identity changed");
      return adaptSessionDetail(wire, time);
    },
    pollMs: 5_000,
  });
}
function useHeadingFocus(sessionId: string, loaded: string | undefined) {
  const heading = useRef<HTMLHeadingElement>(null);
  const location = useLocation();
  const navigated = location.key !== "default";
  // Closing the current tab hands focus to its neighbouring tab, not the heading.
  const tabFocus = Boolean((location.state as FocusState)?.focusTab);
  useEffect(() => {
    if (!navigated || tabFocus) return;
    if (loaded === sessionId) heading.current?.focus();
  }, [navigated, tabFocus, loaded, sessionId]);

  return heading;
}

function splitUnavailable({
  watchable,
  secondAvailable,
  columns,
}: {
  watchable: boolean;
  secondAvailable: boolean;
  columns: number | null;
}) {
  if (!watchable) return "Terminal not available";
  if (!secondAvailable) return "No second session with a terminal";
  if (columns !== null && columns >= MIN_PANE_COLUMNS) return null;
  const measured = columns === null ? "" : ` (${2 * columns} fit)`;
  return `Needs at least ${2 * MIN_PANE_COLUMNS} columns${measured}`;
}

function usePaneLayout(sessionId: string, view: WorkspaceView, watchable: boolean) {
  const { sessions: roster } = useSessionRoster();
  const [panes, paneColumns] = useSplitColumns(watchable);
  const others = roster.filter((o) => o.id !== sessionId && o.terminal);
  const second = others.find((o) => o.id === view.secondId) ?? others[0] ?? null;
  const splitReason = splitUnavailable({ watchable, secondAvailable: Boolean(second), columns: paneColumns });
  // The chosen layout is kept; it applies only while both panes fit (never shrink the font).
  const split = view.layout === "split" && splitReason === null;
  return { panes, others, second, splitReason, split };
}

function exitOnEscape(event: globalThis.KeyboardEvent, exit: () => void) {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  const target = event.target instanceof Element ? event.target : null;
  // Dialogs own Escape. The controlled terminal receives it as input.
  if (target?.closest("dialog, [data-controlling] .xterm")) return;
  event.preventDefault();
  exit();
}
function keepWorkspaceFocus(event: FocusEvent, workspace: HTMLElement | null, exitId: string) {
  const target = event.target;
  if (!(target instanceof Element) || !workspace) return;
  if (workspace.contains(target) || target.closest("dialog")) return;
  document.getElementById(exitId)?.focus();
}
function watchExpandedWorkspace(
  workspace: React.RefObject<HTMLElement | null>,
  exitId: string,
  exit: () => void,
) {
  const onKey = (e: globalThis.KeyboardEvent) => exitOnEscape(e, exit);
  const onFocus = (e: FocusEvent) => keepWorkspaceFocus(e, workspace.current, exitId);
  const root = document.documentElement;
  const overflow = root.style.overflow;
  root.style.overflow = "hidden";
  document.addEventListener("keydown", onKey);
  document.addEventListener("focusin", onFocus);
  return () => {
    root.style.overflow = overflow;
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("focusin", onFocus);
  };
}

function useExpandedView(expanded: boolean, onViewChange: ViewChange) {
  const workspace = useRef<HTMLElement>(null);
  const expandId = useId(),
    exitId = useId();
  useEffect(() => {
    if (!expanded) return;
    const exit = () => {
      document.getElementById(expandId)?.focus();
      onViewChange({ expanded: false });
    };
    return watchExpandedWorkspace(workspace, exitId, exit);
  }, [expanded, onViewChange, expandId, exitId]);
  const changeView = (change: Partial<WorkspaceView>) => {
    if (change.expanded === false) document.getElementById(expandId)?.focus();
    onViewChange(change);
  };
  return { workspace, expandId, exitId, changeView };
}
function useDrawer() {
  const [drawer, setDrawer] = useState<DrawerKind | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const openDrawer = (kind: DrawerKind, from: HTMLElement) => {
    opener.current = from;
    setDrawer((v) => (v === kind ? null : kind));
  };
  const toggle = (kind: DrawerKind) => (e: React.MouseEvent<HTMLElement>) =>
    openDrawer(kind, e.currentTarget);
  const closeDrawer = () => setDrawer(null);
  return { drawer, opener, openDrawer, toggle, closeDrawer };
}
function useSwitcherVisibility() {
  const phone = useMediaQuery("(max-width: 767px)");
  // Desktop keeps the session tabs open; the phone header collapses them behind the name's ▾.
  const [switcherChoice, setSwitcherChoice] = useState<boolean | null>(null);
  const switcherOpen = switcherChoice ?? !phone;
  const switcherToggle = useRef<HTMLButtonElement>(null);
  return { phone, switcherOpen, switcherToggle, setSwitcherChoice };
}

export function useSessionWorkspace(sessionId: string, view: WorkspaceView, onViewChange: ViewChange) {
  const { bootstrap } = useSession();
  const terminal = bootstrap.capability("terminal.watch");
  const taskView = bootstrap.capability("tasks.read");
  const switcher = useSwitcherVisibility();
  const [opsView, setOpsView] = useState<OperationsView>("overview");
  const [feed] = useState(createOutputFeed);
  const messageReason = useId();

  const query = useSessionDetail(sessionId);
  const heading = useHeadingFocus(sessionId, query.data?.view.id);
  const live = !!query.data?.view.terminal && terminal.enabled;
  const layout = usePaneLayout(sessionId, view, live);
  const expanded = view.expanded && !!query.data;
  const expandedView = useExpandedView(expanded, onViewChange);
  const drawer = useDrawer();
  return {
    query,
    heading,
    bootstrap,
    terminal,
    taskView,
    ...switcher,
    opsView,
    setOpsView,
    feed,
    messageReason,
    live,
    onViewChange,
    expanded,
    ...layout,
    ...expandedView,
    ...drawer,
  };
}
export type SessionModel = ReturnType<typeof useSessionWorkspace>;
