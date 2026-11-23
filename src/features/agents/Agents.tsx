import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { scopeSearch, useScope } from "../../app/scope";
import { AgentsTabs } from "./AgentsTabs";
import { SessionRoster } from "./SessionRoster";
import { SessionPage } from "./SessionPage";
import { type WorkspaceView, type ViewChange } from "./useSessionWorkspace";

export type { WorkspaceView } from "./useSessionWorkspace";
export function Agents() {
  const { sessionId } = useParams();
  const [scope] = useScope();
  const search = scopeSearch(scope);
  const container = useRef<HTMLDivElement>(null);
  const lastSelected = useRef<string | null>(null);
  // View state outlives the per-session page so switching sessions keeps the layout.
  const [view, setView] = useState<WorkspaceView>({ layout: "focus", expanded: false, secondId: null });
  const changeView = useCallback<ViewChange>((change) => setView((v) => ({ ...v, ...change })), []);
  // Back from a session returns focus to the roster row that opened it.
  useEffect(() => {
    if (sessionId) {
      lastSelected.current = sessionId;
      return;
    }
    const id = lastSelected.current;
    if (id)
      container.current?.querySelector<HTMLElement>(`li[data-session-id="${CSS.escape(id)}"] a`)?.focus();
  }, [sessionId]);
  return (
    <div ref={container}>
      {sessionId ? (
        <SessionPage
          key={sessionId}
          sessionId={sessionId}
          search={search}
          view={view}
          onViewChange={changeView}
        />
      ) : (
        <>
          <AgentsTabs current="sessions" />
          <SessionRoster search={search} />
        </>
      )}
    </div>
  );
}
