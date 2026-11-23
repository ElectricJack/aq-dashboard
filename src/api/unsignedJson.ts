const JSON_TOKENS = /"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\]]/g;

function registerKey(keys: Set<string> | null | undefined, token: string) {
  const key: string = JSON.parse(token);
  if (!keys || keys.has(key)) throw new Error("Duplicate object key");
  keys.add(key);
}

function validateInteger(token: string) {
  if (!/^(0|[1-9]\d*)$/.test(token) || !Number.isSafeInteger(Number(token))) {
    throw new Error("Unsupported numeric value");
  }
}

/** These endpoints require unique object keys and exact unsigned integers on the wire. */
export function parseUnsignedJson(text: string): unknown {
  const stack: (Set<string> | null)[] = [];
  for (const match of text.matchAll(JSON_TOKENS)) {
    const token = match[0];
    switch (token[0]) {
      case "{": stack.push(new Set()); break;
      case "[": stack.push(null); break;
      case "}": case "]": stack.pop(); break;
      case '"':
        if (/^\s*:/.test(text.slice(match.index + token.length))) registerKey(stack.at(-1), token);
        break;
      default: validateInteger(token);
    }
  }
  return JSON.parse(text) as unknown;
}
