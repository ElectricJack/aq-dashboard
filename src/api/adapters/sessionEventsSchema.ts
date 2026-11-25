import schema from "../../../contracts/live/session-events/events.schema.json";
import { canonicalUuid, ContractError, isRecord } from "./contract";

const definitions = schema.$defs as Record<string, unknown>;
function check(value: unknown): asserts value { if (!value) throw new ContractError("Invalid session source events response"); }
function object(value: unknown): Record<string, unknown> { check(isRecord(value)); return value; }
type Rule = Record<string, unknown>;

function validateObject(r: Rule, value: unknown, depth: number) {
  const v = object(value), properties = object(r.properties);
  if (Array.isArray(r.required)) check(r.required.every(key => typeof key === "string" && Object.hasOwn(v, key)));
  check(r.additionalProperties === false);
  check(Object.keys(v).every(key => Object.hasOwn(properties, key)));
  for (const [key, item] of Object.entries(v)) validate(properties[key], item, depth + 1);
}

function validateArray(r: Rule, value: unknown, depth: number) {
  check(Array.isArray(value));
  if (typeof r.maxItems === "number") check(value.length <= r.maxItems);
  for (const item of value) validate(r.items, item, depth + 1);
}

function validateInteger(r: Rule, value: unknown) {
  check(typeof value === "number" && Number.isSafeInteger(value));
  if (typeof r.minimum === "number") check(value >= r.minimum);
  if (typeof r.maximum === "number") check(value <= r.maximum);
}

function validateString(r: Rule, value: unknown) {
  check(typeof value === "string");
  check(!/\p{Cs}/u.test(value));
  if (typeof r.minLength === "number") check(value.length >= r.minLength);
  if (typeof r.maxLength === "number") check(value.length <= r.maxLength);
  if (typeof r.pattern === "string") check(new RegExp(r.pattern).test(value));
  if (r.format === "uuid") check(canonicalUuid(value));
  if (r === definitions.Text) check(!/\p{Cc}/u.test(value) && new TextEncoder().encode(value).length <= 512);
}

/** Interpreter for the pinned event envelope and its referenced definitions. */
function validate(rule: unknown, value: unknown, depth: number): void {
  check(depth < 32);
  const r = object(rule);
  if (typeof r.$ref === "string") {
    check(r.$ref.startsWith("#/$defs/"));
    validate(definitions[r.$ref.slice(8)], value, depth + 1);
    return;
  }
  const matches = (candidate: unknown) => {
    try { validate(candidate, value, depth + 1); return true; }
    catch { return false; }
  };
  if (Array.isArray(r.oneOf)) check(r.oneOf.filter(matches).length === 1);
  if (Array.isArray(r.anyOf)) check(r.anyOf.some(matches));
  if (Object.hasOwn(r, "const")) check(value === r.const);
  if (Array.isArray(r.enum)) check(r.enum.includes(value));
  if (typeof r.type === "string") typeValidators.get(r.type)?.(r, value, depth);
}

const typeValidators = new Map<string, (rule: Rule, value: unknown, depth: number) => void>([
  ["object", validateObject], ["array", validateArray], ["integer", validateInteger], ["string", validateString],
  ["boolean", (_rule, value) => check(typeof value === "boolean")],
  ["null", (_rule, value) => check(value === null)],
]);

export function validateSessionEventsSchema(value: unknown) { validate(schema, value, 0); }
