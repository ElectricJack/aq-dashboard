import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { PANEL_READ, useSession } from "../../app/session";
import { queryKey } from "../../api/queryKeys";
import { adaptResultMedia, canonicalMedia, isImageArtifact, type MediaArtifact, type MediaBinding, type MediaPage } from "../../api/adapters/resultMedia";
import { resultMediaJson } from "../../api/resultMediaClient";
import { ActionButton } from "../../components/layout/Workspace";
import { VerifiedImage, type ImageAnnotation } from "./VerifiedResultImage";
export type { ImageAnnotation } from "./VerifiedResultImage";
import styles from "./ResultMedia.module.css";

type Selection = { binding: MediaBinding; artifact: MediaArtifact; page: MediaPage; started: number; returnFocus: HTMLElement };
type WindowContext = { active(key: string): boolean; visible(key: string, value: boolean): void; prefer(key: string): void; expand(value: Selection): void };
const MediaWindow = createContext<WindowContext | null>(null);
export const resultMediaKey = (binding: MediaBinding) => canonicalMedia(binding);
function visiblePreviews(keys: string[], visible: Set<string>, preferred: string | null) {
  const chosen = preferred && visible.has(preferred) ? [preferred] : [];
  return [...chosen, ...keys.filter(key => visible.has(key) && key !== preferred)].slice(0, 2);
}

function updateVisibility(visible: Set<string>, key: string, value: boolean) {
  if (visible.has(key) === value) return visible;
  const next = new Set(visible);
  if (value) next.add(key);
  else next.delete(key);
  return next;
}

/** At most two visible selected previews and one explicit expanded render. */
export function ResultMediaWindow({ keys, children }: { keys: string[]; children: ReactNode }) {
  const { bootstrap } = useSession(); const enabled = bootstrap.capability("results.media.read").enabled;
  const [visible, setVisible] = useState<Set<string>>(() => new Set()), [preferred, setPreferred] = useState<string | null>(null), [expanded, setExpanded] = useState<Selection | null>(null);
  const visibility = useCallback((key: string, value: boolean) => { setVisible(old => updateVisibility(old, key, value)); }, []);
  const ordered = visiblePreviews(keys, visible, preferred);
  const close = () => { const button = expanded?.returnFocus; setExpanded(null); requestAnimationFrame(() => { if (button?.isConnected) button.focus(); }); };
  const validExpanded = enabled && expanded && keys.includes(resultMediaKey(expanded.binding));
  useLayoutEffect(() => { if (!validExpanded) setExpanded(null); }, [validExpanded]);
  return <MediaWindow.Provider value={{ active: key => enabled && ordered.includes(key), visible: visibility, prefer: key => { visibility(key, true); setPreferred(key); }, expand: setExpanded }}>
    {children}{validExpanded && <ExpandedImage key={`${resultMediaKey(expanded.binding)}:${expanded.artifact.receipt_digest}`} selection={expanded} close={close} />}
  </MediaWindow.Provider>;
}

/** `evidence` is the card's evidence line: beside the thumbnails, or under the placeholder. */
export function ResultMedia({ binding,onArtifact,annotation,evidence }: { binding: MediaBinding;onArtifact?(artifact:MediaArtifact):void;annotation?:ImageAnnotation;evidence?:ReactNode }) {
  const { bootstrap, queryContext } = useSession(); const window = useContext(MediaWindow)!;
  const enabled = bootstrap.capability("results.media.read").enabled, key = resultMediaKey(binding), element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!enabled || !element.current) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => { for (const entry of entries) window.visible(key, entry.isIntersecting); }, { rootMargin: "0px", threshold: 0 });
    observer.observe(element.current); return () => { observer.disconnect(); window.visible(key, false); };
  }, [key, enabled, window.visible]);
  if (!enabled) return null;
  return <div ref={element} className={styles.surface} data-result-media>
    {window.active(key) ? <MediaGallery key={`${key}:${queryContext.principalId}:${queryContext.authorizationRevision}`} binding={binding} onArtifact={onArtifact} annotation={annotation} evidence={evidence} /> : <><div className={styles.placeholder}><ActionButton onClick={() => window.prefer(key)}>View supplemental images</ActionButton></div><MediaEvidence>{evidence}</MediaEvidence></>}
  </div>;
}
function MediaEvidence({ children }: { children?: ReactNode }) {
  return children && <div className={styles.evidence}>{children}</div>;
}

async function readListing(binding: MediaBinding, signal: AbortSignal) {
  const started = performance.now();
  const page = await adaptResultMedia(await resultMediaJson(binding, signal), binding);
  signal.throwIfAborted();
  return { page, started };
}

function useMediaListing(binding: MediaBinding) {
  const { queryContext } = useSession();
  return useQuery({ queryKey: queryKey(queryContext, "result-media-list", { binding }), meta: PANEL_READ, retry: false, gcTime: 0, staleTime: 0, refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryFn: ({ signal }) => readListing(binding, signal) });
}
function MediaGallery({ binding,onArtifact,annotation,evidence }: { binding: MediaBinding;onArtifact?(artifact:MediaArtifact):void;annotation?:ImageAnnotation;evidence?:ReactNode }) {
  const window = useContext(MediaWindow)!; const [selected, setSelected] = useState<string | null>(null);
  const query = useMediaListing(binding);
  // X26 clips are validated but not shown: this dashboard has no video player.
  const images=query.data?.page.items.filter(isImageArtifact)??[];
  const chosen=images.find(item=>item.receipt.artifact_id===selected)??images[0];
  useEffect(()=>{if(chosen)onArtifact?.(chosen);},[chosen,onArtifact]);
  const below = <MediaEvidence>{evidence}</MediaEvidence>;
  if (query.isPending) return <><p role="status">Loading supplemental images…</p>{below}</>;
  if (query.isError) return <div><p role="status">Supplemental images unavailable.</p><ActionButton onClick={() => void query.refetch()}>Retry images</ActionButton>{below}</div>;
  const { page, started } = query.data;
  const artifact = chosen;
  if (!artifact) return <><p className={styles.note}>No supplemental images are retained for this exact report.</p>{below}</>;
  return <section aria-label="Human supplemental images" className={styles.gallery}>
    <div className={styles.frame}><VerifiedImage binding={binding} artifact={artifact} variant="preview" page={page} started={started} annotation={annotation} /></div>
    <div className={styles.thumbRow}><div className={styles.selector} role="group" aria-label="Supplemental PNG selector">{images.map(item => <ActionButton key={item.receipt.artifact_id} aria-pressed={item.receipt.artifact_id === artifact.receipt.artifact_id} onClick={() => setSelected(item.receipt.artifact_id)}>{item.receipt.input.filename}</ActionButton>)}</div>{evidence}</div>
    <div className={styles.caption}><strong>Image preview</strong><ActionButton disabled={artifact.availability.state !== "available"} onClick={event => window.expand({ binding, artifact, page, started, returnFocus: event.currentTarget })}>Expand image</ActionButton></div>
    <p className={styles.note}>Uploaded by a human. Capture details are unverified.</p>
    <MediaProvenance artifact={artifact} />
    <ActionButton disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh images</ActionButton>
  </section>;
}
function MediaProvenance({ artifact }: { artifact: MediaArtifact }) {
  const capture = artifact.receipt.capture;
  return <details className={styles.provenance}><summary>Image provenance</summary><p>Uploaded by {artifact.receipt.uploader_id}</p><p>Artifact {artifact.receipt.artifact_id}</p><p>Receipt {artifact.receipt_digest}</p>
    <p>Supplemental evidence added after the worker report. This does not establish worker capture, source coverage, acceptance or completion.</p>
    {capture ? <><p>Uploader assertions · not independently verified</p><p>{capture.scenario} · {capture.environment}</p><p>Claimed viewport: {capture.viewport.width_css} × {capture.viewport.height_css} CSS pixels · DPR {capture.viewport.dpr_milli / 1000}</p>{capture.claimed_source && <p>Claimed source: {capture.claimed_source.hex}</p>}</> : <p>No capture assertions supplied.</p>}
  </details>;
}
function retainedArtifact(current: MediaArtifact, selected: MediaArtifact) {
  return current.availability.state === "available"
    && current.receipt.artifact_id === selected.receipt.artifact_id
    && current.receipt_digest === selected.receipt_digest;
}

function ExpandedImage({ selection, close }: { selection: Selection; close(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const listing = useMediaListing(selection.binding);
  const artifact = !listing.isError && listing.data?.page.items.find(item => retainedArtifact(item, selection.artifact));
  const valid = !!artifact;
  useLayoutEffect(() => { if (!valid) close(); }, [valid, close]);
  useLayoutEffect(() => { const element = dialog.current; if (valid) element?.showModal(); return () => element?.close(); }, [valid]);
  if (!artifact || !listing.data) return null;
  return <dialog ref={dialog} className={styles.dialog} aria-label="Expanded supplemental image" onCancel={event => { event.preventDefault(); close(); }}>
    <header className={styles.caption}><h2>{artifact.receipt.input.filename}</h2><ActionButton onClick={close}>Close image</ActionButton></header>
    <p className={styles.note}>Uploaded by a human. Capture details are unverified.</p>
    <div className={styles.expanded}><VerifiedImage binding={selection.binding} artifact={artifact} page={listing.data.page} started={listing.data.started} variant="render" /></div>
    <MediaProvenance artifact={artifact} />
  </dialog>;
}
