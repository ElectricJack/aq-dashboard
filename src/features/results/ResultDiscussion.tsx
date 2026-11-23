import {useEffect,useId,useRef,useState} from "react";
import type {UseInfiniteQueryResult,InfiniteData} from "@tanstack/react-query";
import {ChevronDown,FilePlus2,FileText,Image as ImageIcon,ImagePlus,Video,X} from "lucide-react";
import type {CommentsPage} from "../../api/wire/resultsFeedback";
import {validateResultPayload,mediaBinding,type ResultDetail,type ResultComment,type ResultAnchor} from "../../api/adapters/resultsFeedback";
import type { MediaArtifact } from "../../api/adapters/resultMedia";
import {useSession} from "../../app/session";
import {formatElapsed} from "../../components/time/relative";
import {ActionButton} from "../../components/layout/Workspace";
import {ResultMedia} from "./ResultMedia";
import {ResultMediaUpload} from "./ResultMediaUpload";
import {OperationStatus,useResultOperation} from "./useResultOperation";
import {FeedbackDraft} from "./FeedbackDraft";
import styles from "./Results.module.css";
export type CommentsQuery=UseInfiniteQueryResult<InfiniteData<CommentsPage,unknown>,Error>;

type Thread={key:string;anchor:ResultAnchor;label:string;comments:ResultComment[]};
const shortId=(id:string)=>id.slice(-8);
const clock=(ms:number)=>{const s=Math.max(0,Math.floor(ms/1000));return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;};
const iso=(ms:number)=>new Date(ms).toISOString();
function anchorKey(a:ResultAnchor){
 if(a.kind==="image_region")return `image:${a.artifact_id}:${a.digest}:${a.x}:${a.y}:${a.width}:${a.height}`;
 if(a.kind==="video_range")return `video:${a.artifact_id}:${a.digest}:${a.start_ms}:${a.end_ms}`;
 return "result";
}
/** Short label for an anchor. Pins are numbered in the order they first appear in this discussion. */
function anchorLabel(a:ResultAnchor,pin?:number){
 if(a.kind==="image_region")return `Image${pin?` · pin ${pin}`:" region"}`;
 if(a.kind==="video_range")return `${clock(a.start_ms)}–${clock(a.end_ms)} · Clip`;
 return "Whole result";
}
/** Exact pin facts kept visible so a comment never loses its artifact/revision identity. */
function pinFacts(a:ResultAnchor,detail:ResultDetail){
 const revision=`Revision ${detail.revision.revision.slice(0,10)}`;
 if(a.kind==="image_region")return `${revision} · artifact ${shortId(a.artifact_id)} · region ${a.x.toFixed(2)}, ${a.y.toFixed(2)} · ${a.width.toFixed(2)} × ${a.height.toFixed(2)}`;
 if(a.kind==="video_range")return `${revision} · artifact ${shortId(a.artifact_id)} · ${clock(a.start_ms)} to ${clock(a.end_ms)}`;
 return revision;
}
export function groupThreads(comments:ResultComment[]):Thread[]{
 const threads=new Map<string,Thread>();let pins=0;
 for(const c of comments){const key=anchorKey(c.anchor);let t=threads.get(key);
  if(!t){t={key,anchor:c.anchor,label:anchorLabel(c.anchor,c.anchor.kind==="image_region"?++pins:undefined),comments:[]};threads.set(key,t);}
  t.comments.push(c);}
 return [...threads.values()];
}
function AnchorIcon({anchor}:{anchor:ResultAnchor}){
 const Icon=anchor.kind==="image_region"?ImageIcon:anchor.kind==="video_range"?Video:FileText;
 return <Icon aria-hidden="true" size={18}/>;
}
/**
 * One comment: initials avatar, author (short principal id until display names exist), time
 * relative to the result submission (no server clock is available here), and the body.
 */
export function CommentView({comment,detail,inThread=false}:{comment:ResultComment;detail:ResultDetail;inThread?:boolean}){
 const {queryContext}=useSession(),self=comment.author_id===queryContext.principalId,author=self?"You":shortId(comment.author_id);
 const when=formatElapsed(iso(comment.created_at_ms),iso(detail.revision.submitted_at_ms));
 return <article className={styles.comment}>
  <span className={styles.avatar} aria-hidden="true">{self?"Y":shortId(comment.author_id).slice(-2).toUpperCase()}</span>
  <div className={styles.commentMain}>
   <p className={styles.commentMeta}><strong>{author}</strong>{!inThread&&<span className={styles.commentAnchor}> · {anchorLabel(comment.anchor)}</span>}<time dateTime={iso(comment.created_at_ms)} title={new Date(comment.created_at_ms).toLocaleString()}>{when==="unknown time"?when:`${when} after result`}</time></p>
   <p className={styles.commentText}>{comment.body}</p>
   {comment.thread_state!=="open"&&<span className={styles.threadState}>Thread {comment.thread_state}</span>}
   {comment.history.length>0&&<details className={styles.history}><summary>Original annotation and corrections</summary>{comment.history.map(h=><p key={h.revision}>{h.body}<span className={styles.meta}> · {shortId(h.author_id)} · {new Date(h.recorded_at_ms).toLocaleString()} · revision {h.revision}</span></p>)}</details>}
  </div>
 </article>;
}
function ThreadGroup({thread,detail,feedback}:{thread:Thread;detail:ResultDetail;feedback?:(commentId:string)=>void}){
 const [open,setOpen]=useState(true),id=useId(),last=thread.comments.at(-1)!;
 return <section className={styles.thread} aria-labelledby={`${id}-head`}>
  <h3 className={styles.threadHeading}><button type="button" id={`${id}-head`} className={styles.threadToggle} aria-expanded={open} aria-controls={`${id}-body`} onClick={()=>setOpen(o=>!o)}><AnchorIcon anchor={thread.anchor}/><span className={styles.threadLabel}>{thread.label}</span><ChevronDown aria-hidden="true" size={18} className={styles.chevron}/></button></h3>
  <div id={`${id}-body`} className={styles.threadBody} hidden={!open}>
   <p className={styles.pinFacts}>{pinFacts(thread.anchor,detail)}</p>
   {thread.comments.map(c=><CommentView key={c.id} comment={c} detail={detail} inThread/>)}
   {feedback&&<div className={styles.threadAction}><ActionButton className={`${styles.primary} ${styles.feedbackAction}`} aria-describedby={`${id}-hint`} onClick={()=>feedback(last.id)}><FilePlus2 aria-hidden="true" size={18}/>Create feedback task</ActionButton><p id={`${id}-hint`} className={styles.hint}>Links this comment and capture to new work.</p></div>}
  </div>
 </section>;
}
type Pin = { artifact_id: string; digest: string };
type Region = { x: number; y: number; width: number; height: number };

function selectedAnchor(imageMode: boolean, pin: Pin | null, region: Region): ResultAnchor {
  if (!imageMode) return { kind: "result" };
  if (!pin) throw new Error("Choose a retained image first");
  return { kind: "image_region", ...pin, ...region };
}

function clampRegion(region: Region) {
  return { ...region, x: Math.min(region.x, 1 - region.width), y: Math.min(region.y, 1 - region.height) };
}

function usePinning() {
  const [pin, setPin] = useState<Pin | null>(null);
  const [region, setRegion] = useState<Region>({ x: .1, y: .1, width: .3, height: .3 });
  function selectArtifact(artifact: MediaArtifact) {
    const next = { artifact_id: artifact.receipt.artifact_id, digest: artifact.receipt.input.digest };
    setPin(old => old?.artifact_id === next.artifact_id && old.digest === next.digest ? old : next);
  }
  return { pin, region, selectArtifact,
    place(x: number, y: number) { setRegion(old => clampRegion({ ...old, x, y })); },
    resize(field: keyof Region, value: number) { setRegion(old => clampRegion({ ...old, [field]: value })); },
  };
}

function useDiscussionDraft(detail: ResultDetail, query: CommentsQuery) {
  const [body,setBody] = useState(""), [error,setError] = useState<string | null>(null);
  const [imageMode,setImageMode] = useState(false), [attach,setAttach] = useState(false);
  const pinning = usePinning();
  const operation = useResultOperation(detail.result.project_id, "results.comment");
 async function post(event:React.FormEvent){event.preventDefault();if(operation.id)return;setError(null);try{
  const anchor = selectedAnchor(imageMode, pinning.pin, pinning.region);
  const full={operation_id:crypto.randomUUID(),expected_version:detail.result.version,body,anchor,result_id:detail.result.id,revision:detail.revision.revision};validateResultPayload("Comment",full);
  const {result_id:ignoredResult,revision:ignoredRevision,...payload}=full;void ignoredResult;void ignoredRevision;
  const op=await operation.submit("POST",`/api/v1/results/${detail.result.id}/revisions/${detail.revision.revision}/comments`,payload);
  if(op?.disposition==="confirmed"){setBody("");void query.refetch();}
 }catch{setError("Enter a comment and choose a valid retained image region.");}}
  return { body, setBody, error, imageMode, setImageMode, attach, setAttach, pinning, operation, post };
}

function ImageRegion({ detail, pinning }: { detail: ResultDetail; pinning: ReturnType<typeof usePinning> }) {
  const { region } = pinning;
  return <section aria-label="Image region editor" className={styles.regionEditor}><p className={styles.meta}>Tap the image to place the region. Adjust before posting.</p><ResultMedia binding={mediaBinding(detail)} onArtifact={pinning.selectArtifact} annotation={{ ...region, onPlace: pinning.place }}/>{(["x","y","width","height"] as const).map(field=><label key={field}>Region {field}<input type="range" min={(field==="width"||field==="height") ? .01 : 0} max={1} step={.01} value={region[field]} onChange={e => pinning.resize(field, Number(e.target.value))}/><output>{region[field].toFixed(2)}</output></label>)}</section>;
}

function CommentComposer({ detail, query, draft }: { detail: ResultDetail; query: CommentsQuery; draft: ReturnType<typeof useDiscussionDraft> }) {
  const { bootstrap } = useSession();
  const capability = bootstrap.capability("results.comment");
  if (!capability.enabled) return <p className={styles.meta}>{capability.reason ?? ""}</p>;
  const canImage = bootstrap.capability("results.media.read").enabled, canUpload = bootstrap.capability("results.media.upload").enabled;
  const { body, setBody, error, imageMode, attach, pinning, operation, post } = draft;
  return <form onSubmit={e=>void post(e)} className={styles.composer}>
   <fieldset disabled={!!operation.id}><textarea aria-label="Comment" rows={2} required value={body} onChange={e=>setBody(e.target.value)} placeholder="Comment on this result…"/>
   {imageMode && <ImageRegion detail={detail} pinning={pinning} />}
   <ComposerBar draft={draft} canImage={canImage} canUpload={canUpload} />
   </fieldset>
   {attach&&canUpload&&<ResultMediaUpload binding={mediaBinding(detail)}/>}
   {error&&<p role="alert">{error}</p>}
   <OperationStatus operation={operation} onCheck={()=>{void query.refetch();}}/>{operation.status?.disposition==="confirmed"&&<ActionButton onClick={operation.reset}>Write another comment</ActionButton>}
  </form>;
}

function ComposerBar({ draft, canImage, canUpload }: {
  draft: ReturnType<typeof useDiscussionDraft>; canImage: boolean; canUpload: boolean;
}) {
  const { attach, setAttach, imageMode, setImageMode, operation } = draft;
  return <div className={styles.composerBar}>
    {canUpload?<ActionButton className={styles.iconButton} aria-label="Attach image to this result" aria-expanded={attach} onClick={()=>setAttach(a=>!a)}><ImagePlus aria-hidden="true" size={18}/></ActionButton>:null}
    {canImage?<select className={styles.anchorChip} aria-label="Anchor" value={imageMode?"image":"result"} onChange={e=>setImageMode(e.target.value==="image")}><option value="result">Whole result</option><option value="image">Image region</option></select>:<span className={styles.anchorChip}><span className={styles.anchorChipLabel}>Anchor</span> Whole result</span>}
    {!operation.id&&<ActionButton type="submit" className={`${styles.primary} ${styles.post}`}>Post comment</ActionButton>}
   </div>;
}

function DiscussionThreads({ detail, query, comments, feedback }: {
  detail: ResultDetail; query: CommentsQuery; comments: ResultComment[]; feedback?: (id: string) => void;
}) {
  const threads = groupThreads(comments);
  if (query.isPending) return <p role="status">Loading comments…</p>;
  if (query.isError) return <p role="alert">Comments unavailable. <ActionButton onClick={() => void query.refetch()}>Try comments again</ActionButton></p>;
  return <>
   <div className={styles.threads}>{threads.map(t=><ThreadGroup key={t.key} thread={t} detail={detail} feedback={feedback}/>)}{!comments.length&&<p className={styles.meta}>No comments on this revision.</p>}</div>
   {query.hasNextPage&&<ActionButton disabled={query.isFetchingNextPage} onClick={()=>void query.fetchNextPage()}>Load more comments</ActionButton>}
   {query.data?.pages.length===4&&query.data.pages.at(-1)?.next_cursor&&<p className={styles.meta}>Showing 80 comments. Open the exact revision again for a fresh snapshot.</p>}
  </>;
}

function useDiscussionDialog(sheet: boolean | undefined, onClose: () => void) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => { if (sheet) dialog.current?.close(); onClose(); };
  useEffect(() => {
    const element = dialog.current;
    if (sheet) element?.showModal();
    return () => element?.close();
  }, [sheet]);
  return { dialog, close };
}

function commentCount(query: CommentsQuery, count: number) {
  if (!query.data) return undefined;
  return ` · ${count}${query.hasNextPage ? "+" : ""}`;
}

function DiscussionHeader({ detail, count, close }: { detail: ResultDetail; count?: string; close(): void }) {
  return <header className={styles.panelHeader}><div><h2>Comments{count}</h2><p className={styles.meta}>Task {shortId(detail.result.task_id)} · <span title={`Exact result revision ${detail.revision.revision}`}>revision {detail.revision.revision.slice(0,7)}</span></p></div><ActionButton className={styles.iconButton} onClick={close} aria-label="Close comments"><X aria-hidden="true" size={18}/></ActionButton></header>;
}

export function ResultDiscussion({detail,query,sheet,onClose,onFeedback}:{detail:ResultDetail;query:CommentsQuery;sheet?:boolean;onClose():void;onFeedback?(id?:string):void}) {
  const { bootstrap } = useSession();
  const { dialog, close } = useDiscussionDialog(sheet, onClose);
  const [draft, setDraft] = useState(false);
  const composer = useDiscussionDraft(detail, query);
  const comments = query.data?.pages.flatMap(page => page.items) ?? [];
  const count = commentCount(query, comments.length);
  const feedback = onFeedback ?? (() => setDraft(true));
  const content = <>
    <DiscussionHeader detail={detail} count={count} close={close} />
    <DiscussionThreads detail={detail} query={query} comments={comments} feedback={bootstrap.capability("results.feedback").enabled ? feedback : undefined} />
    <CommentComposer detail={detail} query={query} draft={composer} />
  </>;
 return <>{sheet?<dialog ref={dialog} className={styles.commentsDialog} aria-label="Result comments" onCancel={e=>{e.preventDefault();close();}}>{content}</dialog>:<aside className={styles.discussion} aria-label="Discussion">{content}</aside>}{draft&&<FeedbackDraft detail={detail} comments={comments} onClose={()=>setDraft(false)}/>}</>;
}
