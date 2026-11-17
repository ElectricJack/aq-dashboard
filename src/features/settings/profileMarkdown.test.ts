import { documentId, frontmatterValue, newDocument, readCandidates, reasoningChoices, setFrontmatterValue, writeCandidates, frontmatterText, setFrontmatterText } from "./profileMarkdown";

const LEVEL = "---\nid: standard-high\nname: Standard, high\n---\n## Candidates\n| provider | model | reasoning | harnesses |\n|---|---|---|---|\n| anthropic | claude-sonnet-5-5 | high | claude |\n| openai | gpt-6 | high | codex |\n";
const first = { provider: "anthropic", model: "claude-sonnet-5-5", reasoning: "high", harnesses: ["claude"] };
const second = { provider: "openai", model: "gpt-6", reasoning: "high", harnesses: ["codex"] };

test("reads the candidates table in order, tolerating spacing, blank lines, alignment rules and CRLF", () => {
  expect(readCandidates(LEVEL)).toEqual([first, second]);
  const loose = "---\r\nid: x\r\n---\r\n## Candidates\r\n\r\n|provider|model|reasoning|harnesses|\r\n| :--- | --- | ---: | - |\r\n\r\n|  openai | gpt-6 |high| codex , opencode |\r\n";
  expect(readCandidates(loose)).toEqual([{ ...second, harnesses: ["codex", "opencode"] }]);
});
test("a missing section or a malformed table is not guessed at", () => {
  expect(readCandidates("---\nid: x\n---\n## Selection\n- max_attempts: 3\n")).toBeNull();
  expect(readCandidates(LEVEL.replace("| provider | model | reasoning | harnesses |", "| model | provider | reasoning | harnesses |"))).toBeNull();
  expect(readCandidates(LEVEL.replace("|---|---|---|---|\n", ""))).toBeNull();
  expect(readCandidates(`${LEVEL}| only | three | cells |\n`)).toBeNull();
});
test("writing reordered candidates rewrites only the table, in the server's own form", () => {
  expect(writeCandidates(LEVEL, [second, first])).toBe("---\nid: standard-high\nname: Standard, high\n---\n## Candidates\n| provider | model | reasoning | harnesses |\n|---|---|---|---|\n| openai | gpt-6 | high | codex |\n| anthropic | claude-sonnet-5-5 | high | claude |\n");
  expect(readCandidates(writeCandidates(LEVEL, []))).toEqual([]);
});
test("a section after the table and text around it are kept as written", () => {
  const withSelection = `${LEVEL}\n## Selection\n- max_attempts: 3\n- fallback_on: [unavailable]\n`;
  const written = writeCandidates(withSelection, [second]);
  expect(written).toBe("---\nid: standard-high\nname: Standard, high\n---\n## Candidates\n| provider | model | reasoning | harnesses |\n|---|---|---|---|\n| openai | gpt-6 | high | codex |\n\n## Selection\n- max_attempts: 3\n- fallback_on: [unavailable]\n");
  const selectionFirst = "---\nid: x\n---\n## Selection\n- max_attempts: 3\n\n## Candidates\n| provider | model | reasoning | harnesses |\n|---|---|---|---|\n";
  expect(writeCandidates(selectionFirst, [first])).toBe(`${selectionFirst}| anthropic | claude-sonnet-5-5 | high | claude |\n`);
});
test("a document without the section gains one, and a cell can never break its row", () => {
  const written = writeCandidates("---\nid: x\nname: X\n---\n", [{ provider: "a|b", model: " m ", reasoning: "low", harnesses: ["codex", "opencode"] }]);
  expect(written).toBe("---\nid: x\nname: X\n---\n\n## Candidates\n| provider | model | reasoning | harnesses |\n|---|---|---|---|\n| ab | m | low | codex, opencode |\n");
  expect(readCandidates(written)).toEqual([{ provider: "ab", model: "m", reasoning: "low", harnesses: ["codex", "opencode"] }]);
});
test("a row still being typed is shown as written", () => {
  expect(readCandidates(writeCandidates(LEVEL, [{ provider: "anthropic", model: "", reasoning: "default", harnesses: [] }]))).toEqual([{ provider: "anthropic", model: "", reasoning: "default", harnesses: [] }]);
});
test("reasoning is limited to what every named harness accepts", () => {
  expect(reasoningChoices(["claude"])).toEqual(["default", "off", "low", "medium", "high", "xhigh", "max"]);
  expect(reasoningChoices(["codex"])).toEqual(["default", "low", "medium", "high"]);
  expect(reasoningChoices(["opencode"])).toEqual(["default", "low", "medium", "high"]);
  expect(reasoningChoices(["gemini"])).toEqual(["default"]);
  expect(reasoningChoices(["claude", "codex"])).toEqual(["default", "low", "medium", "high"]);
  expect(reasoningChoices(["claude", "gemini"])).toEqual(["default"]);
  expect(reasoningChoices([])).toEqual(["default"]);
});
test("frontmatter keys are read, replaced in place and added as the last key", () => {
  const role = "---\nid: developer\nname: Developer\nenabled: true\n---\n## Role\nenabled: stays\n";
  expect(documentId(role)).toBe("developer");
  expect(frontmatterValue(role, "enabled")).toBe("true");
  expect(setFrontmatterValue(role, "enabled", "false")).toBe("---\nid: developer\nname: Developer\nenabled: false\n---\n## Role\nenabled: stays\n");
  expect(setFrontmatterValue("---\nid: developer\n---\n## Role\nText\n", "enabled", "false")).toBe("---\nid: developer\nenabled: false\n---\n## Role\nText\n");
  expect(setFrontmatterValue("not a document", "enabled", "false")).toBeNull();
  expect(frontmatterValue("---\nid: x\n", "id")).toBeNull();
});
test("a frontmatter key's free text is read unquoted and written on one line, quoted only when the grammar needs it", () => {
  const level = "---\nid: standard-high\nname: Standard, high\n---\n## Candidates\n";
  expect(frontmatterText(level, "description")).toBe("");
  const described = setFrontmatterText(level, "description", "Ordinary work.\nCheck it carefully.")!;
  expect(described).toBe("---\nid: standard-high\nname: Standard, high\ndescription: Ordinary work. Check it carefully.\n---\n## Candidates\n");
  expect(frontmatterText(described, "description")).toBe("Ordinary work. Check it carefully.");
  // Text that starts with a quote or a bracket, or ends with a space still being typed, is quoted and reads back the same.
  for (const text of ["[draft] work", "\"hard\" work", "work that ends with a space "]) {
    const quoted = setFrontmatterText(level, "description", text)!;
    expect(frontmatterValue(quoted, "description")).toBe(JSON.stringify(text));
    expect(frontmatterText(quoted, "description")).toBe(text);
  }
  // A key cannot be empty, so no text removes its line; other lines, and the same word below the frontmatter, stay.
  expect(setFrontmatterText(`${described}description: stays\n`, "description", "  ")).toBe(`${level}description: stays\n`);
  expect(setFrontmatterText(level, "description", "")).toBe(level);
  expect(frontmatterText("not a document", "description")).toBeNull();
  expect(setFrontmatterText("not a document", "description", "x")).toBeNull();
});
test("new documents start from the grammar of their kind", () => {
  expect(newDocument("role", { execution: "sandbox" })).toContain("execution: sandbox\n");
  expect(readCandidates(newDocument("intelligence"))).toEqual([]);
  expect(newDocument("execution")).toContain("## Limits\n- wall_time_ms: 900000\n");
});
