import type { GraphNode } from "../../api/adapters/humanGraph";
export function withoutRevision(search:string) { const params=new URLSearchParams(search);params.delete("revision");const value=params.toString();return value?`?${value}`:""; }
export const pathFor=(kind:GraphNode["kind"],id?:string)=>`/${kind === "task" ? "work" : "knowledge"}${id?`/${encodeURIComponent(id)}`:""}`;
