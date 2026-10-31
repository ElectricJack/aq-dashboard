import { createContext, useContext, useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useLocation } from "react-router";
import { destination, type DestinationId } from "./destinations";
import { useSession } from "./session";
import styles from "./Shell.module.css";

/** Last focused pathname, owned by the Shell so it survives route component remounts. */
export const TitleFocusContext = createContext<RefObject<string | null> | null>(null);

/** Page title that receives focus after in-app navigation, for screen readers. */
export function PageTitle({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const { pathname } = useLocation();
  const shared = useContext(TitleFocusContext);
  const local = useRef<string | null>(null);
  const previous = shared ?? local;
  useEffect(() => {
    // Focus only when the page changes; search-param updates (scope, filters) keep focus.
    if (previous.current !== null && previous.current !== pathname) ref.current?.focus();
    previous.current = pathname;
  }, [pathname, previous]);
  return (
    <h1 ref={ref} tabIndex={-1} className={styles.title}>
      {children}
    </h1>
  );
}

/**
 * Capability-gated landing for a destination. Content is delivered by later
 * work packages; until then the page says so rather than inventing data.
 */
export function DestinationPage({ id, children }: { id: DestinationId; children?: ReactNode }) {
  const { bootstrap } = useSession();
  const dest = destination(id);
  const capability = dest.capability ? bootstrap.capability(dest.capability) : { enabled: true as const };

  return (
    <>
      <PageTitle>{dest.label}</PageTitle>
      {!capability.enabled ? (
        <div className={styles.notice} role="status">
          <h2>{dest.label} is not available</h2>
          <p>{capability.reason}</p>
          <p className={styles.muted}>
            This view needs the <code>{dest.capability}</code> capability from AQ.
          </p>
        </div>
      ) : (
        (children ?? (
          <div className={styles.notice}>
            <h2>Not built yet</h2>
            <p className={styles.muted}>
              The {dest.label} view is delivered by work package {dest.workPackage}. No data is shown
              until it exists.
            </p>
          </div>
        ))
      )}
    </>
  );
}

export function NotFoundPage() {
  return (
    <>
      <PageTitle>Page not found</PageTitle>
      <p className={styles.muted}>This page does not exist or is not available to you.</p>
    </>
  );
}
