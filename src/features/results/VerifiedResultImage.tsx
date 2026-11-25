import { useLayoutEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PANEL_READ, useSession } from "../../app/session";
import { queryKey } from "../../api/queryKeys";
import type { MediaArtifact, MediaBinding, MediaPage } from "../../api/adapters/resultMedia";
import { MediaUnavailableError, resultMediaBytes } from "../../api/resultMediaClient";
import styles from "./ResultMedia.module.css";

export type ImageAnnotation={x:number;y:number;width:number;height:number;onPlace?(x:number,y:number):void};
const unavailable = { expired: "Image expired.", missing: "Image files are missing.", withheld: "Image withheld by its owner.", failed: "Image verification or storage failed." };
/** No URL is minted until exact length/MIME/receipt/variant/SHA checks finish. */
type ImageProps = {
  binding: MediaBinding; artifact: MediaArtifact; variant: "preview" | "render";
  page: MediaPage; started: number; annotation?: ImageAnnotation;
};

function useImageRetention({ artifact, page, started }: ImageProps, owner: string) {
  const [expired, setExpired] = useState(false);
  const remaining = () => artifact.receipt.retain_until_ms - page.server_time_ms - (performance.now() - started);
  const ttl = remaining();
  useLayoutEffect(() => {
    setExpired(false);
    const duration = remaining();
    if (duration <= 0) { setExpired(true); return; }
    const timer = setTimeout(() => setExpired(true), Math.min(duration, 604800000));
    return () => clearTimeout(timer);
  }, [owner, page.server_time_ms, started]);
  return artifact.availability.state === "available" && !expired && ttl > 0;
}

function useImageUrl(owner: string, bytes?: Uint8Array) {
  const [image, setImage] = useState<{ owner: string; url: string } | null>(null);
  useLayoutEffect(() => {
    if (!bytes) { setImage(null); return; }
    const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: "image/png" }));
    setImage({ owner, url });
    return () => URL.revokeObjectURL(url);
  }, [owner, bytes]);
  return image?.owner === owner ? image.url : undefined;
}

function mediaFailure(error: unknown) {
  if (!(error instanceof MediaUnavailableError)) return "Image unavailable. No previous image is shown.";
  return { media_expired: "Image expired.", media_missing: "Image files are missing.", media_withheld: "Image withheld by its owner.", media_failed: "Image verification or storage failed." }[error.code];
}

export function VerifiedImage(props: ImageProps) {
  const { binding, artifact, variant, annotation } = props;
  const { queryContext } = useSession();
  const owner = JSON.stringify([queryContext, binding, artifact.receipt.artifact_id, artifact.receipt_digest, variant, artifact.receipt.variants[variant]]);
  const [broken, setBroken] = useState<string | null>(null);
  const allowed = useImageRetention(props, owner);
  const query = useQuery({ queryKey: queryKey(queryContext, "result-media-bytes", { binding, artifact: artifact.receipt.artifact_id, receipt: artifact.receipt_digest, variant, descriptor: artifact.receipt.variants[variant] }), meta: PANEL_READ, enabled: allowed, retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryFn: ({ signal }) => resultMediaBytes(binding, artifact, variant, signal) });
  const readable = allowed && !query.isError && broken !== owner;
  const url = useImageUrl(owner, readable ? query.data : undefined);
  if (artifact.availability.state !== "available") return <p role="status">{unavailable[artifact.availability.state]}</p>;
  if (!allowed) return <p role="status">Image expired. Refresh images to inspect current retention.</p>;
  if (query.isError) return <p role="status">{mediaFailure(query.error)}</p>;
  if (broken === owner) return <p role="status">Image could not be displayed.</p>;
  if (!url) return <p role="status">Verifying image…</p>;
  return <AnnotatedImage url={url} artifact={artifact} variant={variant} annotation={annotation} onError={() => setBroken(owner)} />;
}

function AnnotatedImage({ url, artifact, variant, annotation, onError }: Pick<ImageProps, "artifact" | "variant" | "annotation"> & { url: string; onError(): void }) {
  return <div className={styles.annotatable} onPointerDown={event=>{if(!annotation?.onPlace)return;const rect=event.currentTarget.getBoundingClientRect();annotation.onPlace(Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height)));}}><img src={url} alt={`Human supplemental ${artifact.receipt.input.filename}`} width={artifact.receipt.variants[variant].width} height={artifact.receipt.variants[variant].height} onError={onError} />{annotation&&<span aria-label="Pinned image region" className={styles.annotation} style={{left:`${annotation.x*100}%`,top:`${annotation.y*100}%`,width:`${annotation.width*100}%`,height:`${annotation.height*100}%`}}/>}</div>;
}
