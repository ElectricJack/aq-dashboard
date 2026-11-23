import type { Candidate, ModelSuggestion } from "../../api/roleSettings";
import { HARNESS_PROVIDER, reasoningChoices, isToken } from "./profileMarkdown";

export function harnessPatch(row: Candidate, harness: string): Partial<Candidate> {
  const harnesses = harness.split(",").map(item => item.trim()).filter(Boolean);
  return { harnesses, provider: HARNESS_PROVIDER[harness] ?? row.provider, reasoning: reasoningChoices(harnesses).includes(row.reasoning) ? row.reasoning : "default" };
}
/** Where the harness does not fix the provider, an unambiguous model suggestion brings its provider. */
export function modelPatch(row: Candidate, model: string, offered: ModelSuggestion[]): Partial<Candidate> {
  const providers = [...new Set(offered.filter(item => item.model === model).map(item => item.provider))];
  const fixed = row.harnesses.some(harness => HARNESS_PROVIDER[harness]);
  if (fixed || providers.length !== 1) return { model };
  if (isToken(providers[0]!)) return { model, provider: providers[0]! };
  return { model };
}

export function completeCandidate(candidate: Candidate) {
  return isToken(candidate.provider) && isToken(candidate.model);
}
export function moveCandidate(rows: Candidate[], from: number, to: number) {
  const next = [...rows];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}
export function updateCandidate(rows: Candidate[], index: number, patch: Partial<Candidate>) {
  return rows.map((row, i) => i === index ? { ...row, ...patch } : row);
}
export function newCandidate(): Candidate {
  return { provider: "anthropic", model: "", reasoning: "default", harnesses: ["claude"] };
}
