import {useEffect,useLayoutEffect,useRef,useState,type KeyboardEvent} from "react";
import {NODE_W,NODE_H,type GraphLayout} from "./layout";
export const ZOOM_MIN = 0.25, ZOOM_MAX = 2, ZOOM_STEP = 0.25, FIT_MIN = 0.05, PAN_STEP = 48;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const panKeys: Partial<Record<string, [number,number]>> = {ArrowLeft:[-PAN_STEP,0],ArrowRight:[PAN_STEP,0],ArrowUp:[0,-PAN_STEP],ArrowDown:[0,PAN_STEP]};
function modifiedKey(event: KeyboardEvent) {
 return event.ctrlKey || event.metaKey || event.altKey;
}
export function useGraphViewport(layout: GraphLayout, focus: string) {
  const region=useRef<HTMLDivElement>(null), canvas=useRef<HTMLDivElement>(null);
  const [scale,setScale]=useState(1);
  const [nativeFull,setNativeFull]=useState(false), [pageFull,setPageFull]=useState(false);

  // Selection stays in view: after zoom or selection changes, scroll the focused task into the canvas.
  useLayoutEffect(()=>{
    revealSelection(canvas.current,layout,focus,scale);
  },[focus,scale,layout,nativeFull,pageFull]);

  useEffect(()=>{
    const on=()=>setNativeFull(!!region.current&&document.fullscreenElement===region.current);
    document.addEventListener("fullscreenchange",on);return()=>document.removeEventListener("fullscreenchange",on);
  },[]);
  useEffect(()=>{
    if(!pageFull)return;
    const onKey=(e:globalThis.KeyboardEvent)=>{if(e.key==="Escape")setPageFull(false);};
    window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey);
  },[pageFull]);

  const zoomIn=()=>setScale(s=>clamp((Math.floor(s/ZOOM_STEP+1e-6)+1)*ZOOM_STEP,ZOOM_MIN,ZOOM_MAX));
  const zoomOut=()=>setScale(s=>clamp((Math.ceil(s/ZOOM_STEP-1e-6)-1)*ZOOM_STEP,ZOOM_MIN,ZOOM_MAX));
  const fit=()=>{
    const el=canvas.current;if(!el)return;
    const maxH=parseFloat(getComputedStyle(el).maxBlockSize);
    const availH=Number.isFinite(maxH)?maxH:el.clientHeight;
    setScale(clamp(Math.floor(Math.min(el.clientWidth/layout.width,availH/layout.height,1)*100)/100,FIT_MIN,1));
    el.scrollLeft=0;el.scrollTop=0;
    region.current?.scrollIntoView?.({block:"nearest"});
  };
  // Entering full screen fits the graph to the larger canvas; leaving restores the previous zoom.
  const full=nativeFull||pageFull, before=useRef<number|null>(null);
  useLayoutEffect(()=>{
    if(full&&before.current===null){before.current=scale;fit();}
    else if(!full&&before.current!==null){setScale(before.current);before.current=null;}
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on full-screen transitions only
  },[full]);
  const toggleFull=async()=>{
    if(nativeFull){await document.exitFullscreen?.().catch(()=>{});return;}
    if(pageFull){setPageFull(false);return;}
    const el=region.current;
    if(el?.requestFullscreen&&document.fullscreenEnabled){try{await el.requestFullscreen();return;}catch{/* fall back to the in-page view */}}
    setPageFull(true);
  };
  const onKeyDown=(event: KeyboardEvent<HTMLDivElement>) => {
    if (modifiedKey(event)) return;
    const key = event.key;
    const direction = panKeys[key];
    if (direction) {
      event.currentTarget.scrollLeft += direction[0];
      event.currentTarget.scrollTop += direction[1];
    } else {
      switch (key) {
        case "+": case "=": zoomIn(); break;
        case "-": case "_": zoomOut(); break;
        case "0": setScale(1); break;
        default: return;
      }
    }
    event.preventDefault();
  };

  return {region, canvas, scale, nativeFull, pageFull, zoomIn, zoomOut, fit, full, toggleFull, onKeyDown};
}

function revealSelection(el: HTMLDivElement | null,layout: GraphLayout,focus: string,scale: number) {
    const n = layout.nodes.find(n => n.id === focus);
    if(!el||!n)return;
    const x=n.x*scale,y=n.y*scale,w=NODE_W*scale,h=NODE_H*scale;
    if(x<el.scrollLeft||x+w>el.scrollLeft+el.clientWidth)el.scrollLeft=Math.max(0,x+w/2-el.clientWidth/2);
    if(y<el.scrollTop||y+h>el.scrollTop+el.clientHeight)el.scrollTop=Math.max(0,y+h/2-el.clientHeight/2);
}
