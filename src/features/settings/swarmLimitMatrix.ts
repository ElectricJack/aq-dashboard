import type { SwarmCell, SwarmCellLimit, SwarmSettings as SettingsSnapshot } from "../../api/swarmSettings";

type Values = Record<string, string>;
export const MAX_LIMIT = 4_294_967_295;
export const key = (cell: Pick<SwarmCell, "provider" | "intelligence_class">) => JSON.stringify([cell.provider, cell.intelligence_class]);
export function values(settings: SettingsSnapshot, profile: "normal" | "reduced"): Values {
  return Object.fromEntries(settings.cells.map(cell => [key(cell), cell[`${profile}_limit`] === null ? "" : String(cell[`${profile}_limit`])]));
}
function integer(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= MAX_LIMIT ? number : null;
}
function invalidNumber(value: string | undefined) {
  return Number(value) > MAX_LIMIT ? "Enter a whole number from 0 to 4,294,967,295." : "Enter a non-negative whole number.";
}
export function matrix(cells: SwarmCell[], input: Values): SwarmCellLimit[] {
  return cells.map(cell => ({ provider: cell.provider, intelligence_class: cell.intelligence_class, limit: integer(input[key(cell)])! }));
}
export function sameMatrix(a: SwarmCellLimit[] | null, b: SwarmCellLimit[] | null) {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every(cell => b.some(other => key(cell) === key(other) && cell.limit === other.limit));
}

export function matrixIssues(cells: SwarmCell[], normal: Values, reduced: Values, hasReduced: boolean) {
  const issues: Record<string, string> = {};
  for (const cell of cells) {
    const id = key(cell), n = integer(normal[id]), r = integer(reduced[id]);
    if (n === null) issues[`normal${id}`] = invalidNumber(normal[id]);
    if (!hasReduced) continue;
    if (r === null) issues[`reduced${id}`] = invalidNumber(reduced[id]);
    else if (n !== null && r > n) issues[`reduced${id}`] = "Reduced must be at or below Normal.";
  }
  return issues;
}
