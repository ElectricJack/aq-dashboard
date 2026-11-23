import { isRecord } from "./contract";

export type Rule = { $ref?: string; oneOf?: Rule[]; anyOf?: Rule[]; const?: unknown; enum?: unknown[]; type?: string|string[]; properties?: Record<string,Rule>; required?: string[]; additionalProperties?: boolean; items?: Rule; minItems?: number; maxItems?: number; minLength?: number; maxLength?: number; pattern?: string; format?: string; minimum?: number; maximum?: number };

type Definitions = Record<string, Rule>;

function matchesObject(v: unknown, rule: Rule, defs: Definitions): boolean {
  if (!isRecord(v) || rule.required?.some(key => !Object.hasOwn(v, key))) return false;
  return Object.entries(v).every(([key, value]) => {
    const field = rule.properties?.[key];
    return field ? matches(value, field, defs) : rule.additionalProperties !== false;
  });
}

function matchesArray(v: unknown, rule: Rule, defs: Definitions): boolean {
  if (!Array.isArray(v)) return false;
  if (v.length > (rule.maxItems ?? 1000) || v.length < (rule.minItems ?? 0)) return false;
  const item = rule.items;
  return !item || v.every(value => matches(value, item, defs));
}

function matchesString(v: unknown, rule: Rule): boolean {
  if (typeof v !== "string") return false;
  const length = [...v].length;
  if (length < (rule.minLength ?? 0) || length > (rule.maxLength ?? 65536)) return false;
  if (rule.pattern && !new RegExp(rule.pattern).test(v)) return false;
  return rule.format !== "uuid" || /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
}

function matchesNumber(v: unknown, rule: Rule): boolean {
  if (typeof v !== "number" || !Number.isFinite(v)) return false;
  if (rule.type === "integer" && !Number.isSafeInteger(v)) return false;
  return v >= (rule.minimum ?? -Infinity) && v <= (rule.maximum ?? Infinity);
}

const matchType = new Map<string, (v: unknown, rule: Rule, defs: Definitions) => boolean>([
  ["null", v => v === null], ["object", matchesObject], ["array", matchesArray], ["string", matchesString],
  ["integer", matchesNumber], ["number", matchesNumber], ["boolean", v => typeof v === "boolean"],
]);

function matchesConstraints(v: unknown, rule: Rule, defs: Definitions): boolean {
  const candidateMatches = (candidate: Rule) => matches(v, candidate, defs);
  if (rule.oneOf && rule.oneOf.filter(candidateMatches).length !== 1) return false;
  if (rule.anyOf && !rule.anyOf.some(candidateMatches)) return false;
  if ("const" in rule && v !== rule.const) return false;
  return rule.enum?.includes(v) ?? true;
}

/** The validation vocabulary of the pinned Results and Action schemas. */
export function matches(v: unknown, rule: Rule, defs: Definitions): boolean {
  if (rule.$ref) return matches(v, defs[rule.$ref.split("/").at(-1)!]!, defs);
  if (!matchesConstraints(v, rule, defs)) return false;
  if (Array.isArray(rule.type)) return rule.type.some(type => matches(v, { ...rule, type }, defs));
  return matchType.get(rule.type ?? "")?.(v, rule, defs) ?? true;
}
