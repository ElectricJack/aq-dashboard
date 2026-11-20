type ChangedLine = { kind: "added" | "removed"; text: string; line: number };
const MAX_LINES = 1024;

/** A bounded line diff. Line numbers refer to the old document for removals and the new one for additions. */
export function documentChanges(previous: string, current: string): ChangedLine[] | null {
  if (previous === current) return [];
  const lines = (text: string) => text ? text.replace(/\r\n?/g, "\n").split("\n") : [];
  const before = lines(previous), after = lines(current);
  if (before.length > MAX_LINES || after.length > MAX_LINES) return null;

  const stride = after.length + 1;
  const lengths = new Uint16Array((before.length + 1) * stride);
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      const k = i * stride + j;
      lengths[k] = before[i] === after[j]
        ? lengths[k + stride + 1]! + 1
        : Math.max(lengths[k + stride]!, lengths[k + 1]!);
    }
  }

  const changes: ChangedLine[] = [];
  let i = 0, j = 0;
  while (i < before.length || j < after.length) {
    const k = i * stride + j;
    if (i < before.length && j < after.length && before[i] === after[j]) {
      i++;
      j++;
    } else if (i < before.length && (j === after.length || lengths[k + stride]! >= lengths[k + 1]!)) {
      changes.push({ kind: "removed", line: i + 1, text: before[i++]! });
    } else {
      changes.push({ kind: "added", line: j + 1, text: after[j++]! });
    }
  }
  return changes;
}
