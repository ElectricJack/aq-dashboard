import { createContext, useContext, useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useLocation, useNavigationType } from "react-router";
import { returnsFocusOnBack } from "./focusReturn";
import { destination, type DestinationId } from "./destinations";
import { useDocumentTitle } from "./documentTitle";
import { useSession } from "./session";
import styles from "./Shell.module.css";
import { PageHeader } from "../components/layout/PageHeader";

/** Last focused destination, owned by the Shell so it survives route component remounts. */
export const TitleFocusContext = createContext<RefObject<string | null> | null>(null);

/** Page title that receives focus after in-app navigation, for screen readers. */
export function PageTitle({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const location = useLocation();
  const navigation = useNavigationType();
  const destination = location.pathname.split("/")[1] ?? "";
  const shared = useContext(TitleFocusContext);
  const local = useRef<string | null>(null);
  const previous = shared ?? local;
  useEffect(() => {
    // Focus only when the destination changes. Search-param updates (scope, filters) and
    // in-destination navigation (list -> detail) manage their own focus.
    // Back/Forward to an entry left through a link returns focus to that link instead.
    const restoring = navigation === "POP" && returnsFocusOnBack(location.key);
    if (previous.current !== null && previous.current !== destination && !restoring) ref.current?.focus();
    previous.current = destination;
  }, [destination, previous, navigation, location.key]);
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
      <PageHeader title={dest.label} />
      {!capability.enabled ? (
        <div className={styles.notice} role="status">
          <h2>{dest.label} is not available</h2>
          <p>{capability.reason}</p>
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
  useDocumentTitle("Page not found");
  return (
    <>
      <PageTitle>Page not found</PageTitle>
      <p className={styles.muted}>This page does not exist or is not available to you.</p>
    </>
  );
}
