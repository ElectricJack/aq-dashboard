import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "../../app/session";
import { queryKey } from "../../api/queryKeys";
import { adaptResultMedia, canonicalMedia, type MediaArtifact, type MediaBinding, type MediaPage } from "../../api/adapters/resultMedia";
import { MediaUnavailableError, resultMediaBytes, resultMediaJson } from "../../api/resultMediaClient";
import { ActionButton } from "../../components/layout/Workspace";
import styles from "./ResultMedia.module.css";

type Selection = { binding: MediaBinding; artifact: MediaArtifact; page: MediaPage; started: number; returnFocus: HTMLElement };
type WindowContext = { active(key: string): boolean; visible(key: string, value: boolean): void; prefer(key: string): void; expand(value: Selection): void };
const MediaWindow = createContext<WindowContext | null>(null);
export const resultMediaKey = (binding: MediaBinding) => canonicalMedia(binding);
/** At most two visible selected previews and one explicit expanded render. */
export function ResultMediaWindow({ keys, children }: { keys: string[]; children: ReactNode }) {
  const { bootstrap } = useSession(); const enabled = bootstrap.capability("results.media.read").enabled;
  const [visible, setVisible] = useState<Set<string>>(() => new Set()), [preferred, setPreferred] = useState<string | null>(null), [expanded, setExpanded] = useState<Selection | null>(null);
  const visibility = useCallback((key: string, value: boolean) => { setVisible(old => { if (old.has(key) === value) return old; const next = new Set(old); if (value) next.add(key); else next.delete(key); return next; }); }, []);
  const ordered = [...(preferred && visible.has(preferred) ? [preferred] : []), ...keys.filter(key => visible.has(key) && key !== preferred)].slice(0, 2);
  const close = () => { const button = expanded?.returnFocus; setExpanded(null); requestAnimationFrame(() => { if (button?.isConnected) button.focus(); }); };
  const validExpanded = enabled && expanded && keys.includes(resultMediaKey(expanded.binding));
  useLayoutEffect(() => { if (!validExpanded) setExpanded(null); }, [validExpanded]);
  return <MediaWindow.Provider value={{ active: key => enabled && ordered.includes(key), visible: visibility, prefer: key => { visibility(key, true); setPreferred(key); }, expand: setExpanded }}>
    {children}{validExpanded && <ExpandedImage key={`${resultMediaKey(expanded.binding)}:${expanded.artifact.receipt_digest}`} selection={expanded} close={close} />}
  </MediaWindow.Provider>;
}
export type ImageAnnotation={x:number;y:number;width:number;height:number;onPlace?(x:number,y:number):void};
/** `evidence` is the card's evidence line: beside the thumbnails, or under the placeholder. */
export function ResultMedia({ binding,onArtifact,annotation,evidence }: { binding: MediaBinding;onArtifact?(artifact:MediaArtifact):void;annotation?:ImageAnnotation;evidence?:ReactNode }) {
  const { bootstrap, queryContext } = useSession(); const window = useContext(MediaWindow)!;
  const enabled = bootstrap.capability("results.media.read").enabled, key = resultMediaKey(binding), element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!enabled || !element.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => { for (const entry of entries) window.visible(key, entry.isIntersecting); }, { rootMargin: "0px", threshold: 0 });
    observer.observe(element.current); return () => { observer.disconnect(); window.visible(key, false); };
  }, [key, enabled, window.visible]);
  if (!enabled) return null;
  return <div ref={element} className={styles.surface} data-result-media>
    {window.active(key) ? <MediaGallery key={`${key}:${queryContext.principalId}:${queryContext.authorizationRevision}`} binding={binding} onArtifact={onArtifact} annotation={annotation} evidence={evidence} /> : <><div className={styles.placeholder}><ActionButton onClick={() => window.prefer(key)}>View supplemental images</ActionButton></div>{evidence && <div className={styles.evidence}>{evidence}</div>}</>}
  </div>;
}
function useMediaListing(binding: MediaBinding) {
  const { queryContext } = useSession();
  return useQuery({ queryKey: queryKey(queryContext, "result-media-list", { binding }), retry: false, gcTime: 0, staleTime: 0, refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryFn: async ({ signal }) => { const started = performance.now(); const page = await adaptResultMedia(await resultMediaJson(binding, signal), binding); signal.throwIfAborted(); return { page, started }; } });
}
function MediaGallery({ binding,onArtifact,annotation,evidence }: { binding: MediaBinding;onArtifact?(artifact:MediaArtifact):void;annotation?:ImageAnnotation;evidence?:ReactNode }) {
  const window = useContext(MediaWindow)!; const [selected, setSelected] = useState<string | null>(null);
  const query = useMediaListing(binding);
  const chosen=query.data?.page.items.find(item=>item.receipt.artifact_id===selected)??query.data?.page.items[0];
  useEffect(()=>{if(chosen)onArtifact?.(chosen);},[chosen,onArtifact]);
  const below = evidence && <div className={styles.evidence}>{evidence}</div>;
  if (query.isPending) return <><p role="status">Loading supplemental images…</p>{below}</>;
  if (query.isError) return <div><p role="status">Supplemental images unavailable.</p><ActionButton onClick={() => void query.refetch()}>Retry images</ActionButton>{below}</div>;
  const { page, started } = query.data;
  const artifact = page.items.find(item => item.receipt.artifact_id === selected) ?? page.items[0];
  if (!artifact) return <><p className={styles.note}>No supplemental images are retained for this exact report.</p>{below}</>;
  return <section aria-label="Human supplemental images" className={styles.gallery}>
    <div className={styles.frame}><VerifiedImage binding={binding} artifact={artifact} variant="preview" page={page} started={started} annotation={annotation} /></div>
    <div className={styles.thumbRow}><div className={styles.selector} role="group" aria-label="Supplemental PNG selector">{page.items.map(item => <ActionButton key={item.receipt.artifact_id} aria-pressed={item.receipt.artifact_id === artifact.receipt.artifact_id} onClick={() => setSelected(item.receipt.artifact_id)}>{item.receipt.input.filename}</ActionButton>)}</div>{evidence}</div>
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
const unavailable = { expired: "Image expired.", missing: "Image files are missing.", withheld: "Image withheld by its owner.", failed: "Image verification or storage failed." };
/** No URL is minted until exact length/MIME/receipt/variant/SHA checks finish. */
function VerifiedImage({ binding, artifact, variant, page, started,annotation }: { binding: MediaBinding; artifact: MediaArtifact; variant: "preview" | "render"; page: MediaPage; started: number;annotation?:ImageAnnotation }) {
  const { queryContext } = useSession();
  const owner = JSON.stringify([queryContext, binding, artifact.receipt.artifact_id, artifact.receipt_digest, variant, artifact.receipt.variants[variant]]);
  const [expired, setExpired] = useState(false), [broken, setBroken] = useState<string | null>(null), [image, setImage] = useState<{ owner: string; url: string } | null>(null);
  const ttl = artifact.receipt.retain_until_ms - page.server_time_ms - (performance.now() - started);
  const allowed = artifact.availability.state === "available" && !expired && ttl > 0;
  useLayoutEffect(() => { setExpired(false); const remaining = artifact.receipt.retain_until_ms - page.server_time_ms - (performance.now() - started); if (remaining <= 0) { setExpired(true); return; } const timer = setTimeout(() => setExpired(true), Math.min(remaining, 604800000)); return () => clearTimeout(timer); }, [owner, page.server_time_ms, started]);
  const query = useQuery({ queryKey: queryKey(queryContext, "result-media-bytes", { binding, artifact: artifact.receipt.artifact_id, receipt: artifact.receipt_digest, variant, descriptor: artifact.receipt.variants[variant] }), enabled: allowed, retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryFn: ({ signal }) => resultMediaBytes(binding, artifact, variant, signal) });
  useLayoutEffect(() => {
    if (!allowed || query.isError || !query.data || broken === owner) { setImage(null); return; }
    const url = URL.createObjectURL(new Blob([Uint8Array.from(query.data)], { type: "image/png" })); setImage({ owner, url });
    return () => URL.revokeObjectURL(url);
  }, [owner, allowed, query.data, query.isError, broken]);
  if (artifact.availability.state !== "available") return <p role="status">{unavailable[artifact.availability.state]}</p>;
  if (!allowed) return <p role="status">Image expired. Refresh images to inspect current retention.</p>;
  if (query.isError) return <p role="status">{query.error instanceof MediaUnavailableError ? { media_expired: "Image expired.", media_missing: "Image files are missing.", media_withheld: "Image withheld by its owner.", media_failed: "Image verification or storage failed." }[query.error.code] : "Image unavailable. No previous image is shown."}</p>;
  if (broken === owner) return <p role="status">Image could not be displayed.</p>;
  return image?.owner === owner ? <div className={styles.annotatable} onPointerDown={event=>{if(!annotation?.onPlace)return;const rect=event.currentTarget.getBoundingClientRect();annotation.onPlace(Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height)));}}><img src={image.url} alt={`Human supplemental ${artifact.receipt.input.filename}`} width={artifact.receipt.variants[variant].width} height={artifact.receipt.variants[variant].height} onError={() => setBroken(owner)} />{annotation&&<span aria-label="Pinned image region" className={styles.annotation} style={{left:`${annotation.x*100}%`,top:`${annotation.y*100}%`,width:`${annotation.width*100}%`,height:`${annotation.height*100}%`}}/>}</div> : <p role="status">Verifying image…</p>;
}
function ExpandedImage({ selection, close }: { selection: Selection; close(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const listing = useMediaListing(selection.binding);
  const artifact = !listing.isError && listing.data?.page.items.find(item => item.receipt.artifact_id === selection.artifact.receipt.artifact_id && item.receipt_digest === selection.artifact.receipt_digest && item.availability.state === "available");
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
