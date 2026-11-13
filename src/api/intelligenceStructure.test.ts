import { ContractError } from "./adapters/contract";
import { adaptIntelligenceStructure, INTELLIGENCE_PARENTS } from "./intelligenceStructure";

const snapshot = () => ({ revision: "1", catalog_revision: "12", routing_markdown: "# Routing\n\nUse parent profiles.\n", parents: INTELLIGENCE_PARENTS.map(id => ({ id, description: `${id} work` })), assignments: [{ profile_id: "existing-low", parent_id: "simple", effort: "low" }] });

test("preserves exact Markdown and stable child references", () => {
  const value = snapshot(); value.routing_markdown = "\n# Policy\n\n- Simple → bounded work 🙂\n\n";
  expect(adaptIntelligenceStructure(value)).toEqual(value);
});
test("rejects duplicate parent or effort slots and malformed revisions", () => {
  const value = snapshot();
  for (const invalid of [
    { ...value, parents: [value.parents[0], ...value.parents.slice(0, 3)] },
    { ...value, assignments: [...value.assignments, { profile_id: "another-low", parent_id: "simple", effort: "low" }] },
    { ...value, assignments: [...value.assignments, { profile_id: "existing-low", parent_id: "complex", effort: "max" }] },
    { ...value, assignments: [{ profile_id: "x", parent_id: "other", effort: "low" }] },
    { ...value, assignments: [{ profile_id: "x", parent_id: "simple", effort: "xhigh" }] },
    { ...value, revision: "01" }, { ...value, catalog_revision: "unknown" },
  ]) expect(() => adaptIntelligenceStructure(invalid)).toThrow(ContractError);
});
test("bounds policy source by UTF-8 bytes rather than characters", () => {
  expect(() => adaptIntelligenceStructure({ ...snapshot(), routing_markdown: "a".repeat(128 * 1024) })).not.toThrow();
  expect(() => adaptIntelligenceStructure({ ...snapshot(), routing_markdown: "🙂".repeat(40_000) })).toThrow(ContractError);
});
