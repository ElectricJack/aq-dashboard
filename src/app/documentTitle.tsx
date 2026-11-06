import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { DESTINATIONS } from "./destinations";

export const APP_NAME = "Agent Q";

type Detail = { path: string; title: string };
const DetailContext = createContext<((detail: Detail | null) => void) | null>(null);

/** "Work — Agent Q": distinguishable tabs and history entries (WCAG 2.4.2, QA SO-23). */
export function documentTitle(page: string | null | undefined): string {
  return page ? `${page} — ${APP_NAME}` : APP_NAME;
}

export function destinationTitle(pathname: string): string {
  const segment = pathname.split("/")[1] ?? "";
  return DESTINATIONS.find((d) => d.id === segment)?.label ?? "Page not found";
}

/**
 * Owns `document.title`: the destination's name, unless the page on the
 * current path named something more specific with `useDocumentTitle`.
 */
export function DocumentTitleProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [detail, setDetail] = useState<Detail | null>(null);
  const page = detail?.path === pathname ? detail.title : destinationTitle(pathname);
  useLayoutEffect(() => {
    document.title = documentTitle(page);
  }, [page]);
  useLayoutEffect(() => () => { document.title = APP_NAME; }, []);
  return <DetailContext value={setDetail}>{children}</DetailContext>;
}

/**
 * A more specific title for the current page, such as "Result f195da8" or a
 * task title. Pass null while it is unknown; the destination name is used.
 */
export function useDocumentTitle(title: string | null | undefined) {
  const set = useContext(DetailContext);
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    if (!set || !title) return;
    set({ path: pathname, title });
    return () => set(null);
  }, [set, pathname, title]);
}
