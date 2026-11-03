import {useEffect,useRef,useState} from "react";
import type {UseInfiniteQueryResult,InfiniteData} from "@tanstack/react-query";
import type {CommentsPage} from "../../api/wire/resultsFeedback";
import {validateResultPayload,mediaBinding,type ResultDetail,type ResultComment,type ResultAnchor} from "../../api/adapters/resultsFeedback";
import {useSession} from "../../app/session";
import {ActionButton} from "../../components/layout/Workspace";
import {ResultMedia} from "./ResultMedia";
import {OperationStatus,useResultOperation} from "./useResultOperation";
import {FeedbackDraft} from "./FeedbackDraft";
import styles from "./Results.module.css";
export type CommentsQuery=UseInfiniteQueryResult<InfiniteData<CommentsPage,unknown>,Error>;
export function CommentView({comment,detail}:{comment:ResultComment;detail:ResultDetail}){
 const a=comment.anchor;
 return <article className={styles.comment}><p className={styles.meta}><strong>{comment.author_id.slice(-8)}</strong> · <time dateTime={new Date(comment.created_at_ms).toISOString()}>{new Date(comment.created_at_ms).toLocaleString()}</time> · {comment.thread_state}</p><p>{comment.body}</p><details><summary>{a.kind==="image_region"?"Pinned image region":"Pinned result revision"}</summary><p className={styles.meta}>{detail.revision.revision}</p>{a.kind==="image_region"&&<p className={styles.meta}>Artifact {a.artifact_id} · {a.digest}<br/>Region: x {a.x}, y {a.y}, width {a.width}, height {a.height}</p>}{comment.history.length>0&&<><h4>Original annotation and corrections</h4>{comment.history.map(h=><p key={h.revision}>{h.body}<span className={styles.meta}> · {h.author_id} · {new Date(h.recorded_at_ms).toLocaleString()} · revision {h.revision}</span></p>)}</>}</details></article>;
}
export function ResultDiscussion({detail,query,sheet,onClose,onFeedback}:{detail:ResultDetail;query:CommentsQuery;sheet?:boolean;onClose():void;onFeedback?(id?:string):void}){
 const {bootstrap}=useSession(),dialog=useRef<HTMLDialogElement>(null),[body,setBody]=useState(""),[error,setError]=useState<string|null>(null),[imageMode,setImageMode]=useState(false),[pin,setPin]=useState<{artifact_id:string;digest:string}|null>(null),[region,setRegion]=useState({x:.1,y:.1,width:.3,height:.3}),[draft,setDraft]=useState(false);
 const operation=useResultOperation(detail.result.project_id,"results.comment");
 const comments=query.data?.pages.flatMap(p=>p.items)??[];
 useEffect(()=>{const element=dialog.current;if(sheet)element?.showModal();return()=>element?.close();},[sheet]);
 async function post(event:React.FormEvent){event.preventDefault();if(operation.id)return;setError(null);try{
  const anchor:ResultAnchor=imageMode&&pin?{kind:"image_region",...pin,...region}:{kind:"result"};if(imageMode&&!pin)throw new Error("Choose a retained image first");
  const full={operation_id:crypto.randomUUID(),expected_version:detail.result.version,body,anchor,result_id:detail.result.id,revision:detail.revision.revision};validateResultPayload("Comment",full);
  const {result_id:ignoredResult,revision:ignoredRevision,...payload}=full;void ignoredResult;void ignoredRevision;
  const op=await operation.submit("POST",`/api/v1/results/${detail.result.id}/revisions/${detail.revision.revision}/comments`,payload);
  if(op?.disposition==="confirmed"){setBody("");void query.refetch();}
 }catch{setError("Enter a comment and choose a valid retained image region.");}}
 const content=<><header className={styles.panelHeader}><div><h2>Comments</h2><p className={styles.meta}>Exact result revision · {detail.revision.revision.slice(0,10)}</p></div><ActionButton onClick={onClose} aria-label="Close comments">Close</ActionButton></header>
  {query.isPending?<p role="status">Loading comments…</p>:query.isError?<p role="alert">Comments unavailable. <ActionButton onClick={()=>void query.refetch()}>Try comments again</ActionButton></p>:<>
   <div aria-label="Discussion">{comments.map(c=><div key={c.id}><CommentView comment={c} detail={detail}/>{bootstrap.capability("results.feedback").enabled&&<ActionButton onClick={()=>onFeedback?onFeedback(c.id):setDraft(true)}>Create task from comment</ActionButton>}</div>)}{!comments.length&&<p>No comments on this revision.</p>}</div>
   {query.hasNextPage&&<ActionButton disabled={query.isFetchingNextPage} onClick={()=>void query.fetchNextPage()}>Load more comments</ActionButton>}
   {query.data?.pages.length===4&&query.data.pages.at(-1)?.next_cursor&&<p className={styles.meta}>Showing 80 comments. Open the exact revision again for a fresh snapshot.</p>}
  </>}
  {bootstrap.capability("results.comment").enabled?<form onSubmit={e=>void post(e)} className={styles.fields}>
   <fieldset disabled={!!operation.id}><label>Comment<textarea rows={3} required value={body} onChange={e=>setBody(e.target.value)} placeholder="Discuss this result…"/></label>
   <label>Anchor<select value={imageMode?"image":"result"} onChange={e=>setImageMode(e.target.value==="image")}><option value="result">Whole result revision</option>{bootstrap.capability("results.media.read").enabled&&<option value="image">Image region</option>}</select></label>
   {imageMode&&<section aria-label="Image region editor"><p className={styles.meta}>Tap the image to place the region. Adjust before posting.</p><ResultMedia binding={mediaBinding(detail)} onArtifact={a=>{const next={artifact_id:a.receipt.artifact_id,digest:a.receipt.input.digest};setPin(old=>old?.artifact_id===next.artifact_id&&old.digest===next.digest?old:next);}} annotation={{...region,onPlace:(x,y)=>setRegion(old=>({...old,x:Math.min(x,1-old.width),y:Math.min(y,1-old.height)}))}}/>{(["x","y","width","height"] as const).map(field=><label key={field}>Region {field}<input type="range" min={(field==="width"||field==="height") ? .01 : 0} max={1} step={.01} value={region[field]} onChange={e=>setRegion(old=>{const next={...old,[field]:Number(e.target.value)};next.x=Math.min(next.x,1-next.width);next.y=Math.min(next.y,1-next.height);return next;})}/><output>{region[field].toFixed(2)}</output></label>)}</section>}
   </fieldset>{!operation.id&&<ActionButton type="submit" className={styles.primary}>Post comment</ActionButton>}{error&&<p role="alert">{error}</p>}
   <OperationStatus operation={operation} onCheck={()=>{void query.refetch();}}/>{operation.status?.disposition==="confirmed"&&<ActionButton onClick={operation.reset}>Write another comment</ActionButton>}
  </form>:<p className={styles.meta}>{capReason(bootstrap.capability("results.comment"))}</p>}
  <p className={styles.meta}>Linked-work status unavailable.</p>
 </>;
 return <>{sheet?<dialog ref={dialog} className={styles.commentsDialog} aria-label="Result comments" onCancel={e=>{e.preventDefault();onClose();}}>{content}</dialog>:<aside className={styles.discussion} aria-label="Selected result comments">{content}</aside>}{draft&&<FeedbackDraft detail={detail} comments={comments} onClose={()=>setDraft(false)}/>}</>;
}

function capReason(cap:{enabled:boolean;reason?:string}){return cap.reason??"";}
