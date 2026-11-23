const STRING_CONTROLS = new Set([0x5d, 0x50, 0x58, 0x5e, 0x5f]);

function inRange(byte: number | undefined, low: number, high: number): boolean {
  return byte !== undefined && byte >= low && byte <= high;
}

function skipRange(bytes: Uint8Array, at: number, low: number, high: number) {
  while (inRange(bytes[at], low, high)) at++;
  return at;
}

function controlSequenceEnd(bytes: Uint8Array, start: number): number | undefined {
  const intermediate = skipRange(bytes, start + 1, 0x30, 0x3f);
  const end = skipRange(bytes, intermediate, 0x20, 0x2f);
  if (!inRange(bytes[end], 0x40, 0x7e)) return;
  const mouse = bytes[start] === 0x5b && end === start + 1 && bytes[end] === 0x4d;
  if (!mouse) return end + 1;
  const coordinates = bytes.subarray(end + 1, end + 4);
  return coordinates.length === 3 && !coordinates.includes(0x1b) ? end + 4 : undefined;
}

function controlStringEnd(bytes: Uint8Array, start: number): number | undefined {
  for (let end = start + 1; end < bytes.length; end++) {
    if (bytes[start] === 0x5d && bytes[end] === 7) return end + 1;
    if (bytes[end] === 0x1b) return bytes[end + 1] === 0x5c ? end + 2 : undefined;
  }
}

/** End of one escape-prefixed keyboard report. An incomplete report has no
 * boundary, including ESC by itself. Escape has its own explicit key action. */
function escapeEnd(bytes: Uint8Array, start: number): number | undefined {
  const prefix = bytes[start];
  if (prefix === undefined || prefix === 0x1b) return;
  if ([0x5b, 0x4f].includes(prefix)) return controlSequenceEnd(bytes, start);
  if (STRING_CONTROLS.has(prefix)) return controlStringEnd(bytes, start);
  if (inRange(prefix, 0x20, 0x2f)) {
    const end = skipRange(bytes, start + 1, 0x20, 0x2f);
    return inRange(bytes[end], 0x30, 0x7e) ? end + 1 : undefined;
  }
  const end = start + utf8Width(prefix);
  return end <= bytes.length ? end : undefined;
}

function utf8Width(first: number): number {
  if (first >= 0xf0 && first <= 0xf4) return 4;
  if (first >= 0xe0 && first <= 0xef) return 3;
  if (first >= 0xc2 && first <= 0xdf) return 2;
  return 1;
}

/** Plan the entire event before sending any bytes, even when its last escape
 * sequence is incomplete. Cut large pastes only between complete units. */
export function terminalInputChunks(bytes: Uint8Array, limit: number): Uint8Array<ArrayBuffer>[] | undefined {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let start = 0;
  for (let at = 0; at < bytes.length;) {
    const end = bytes[at] === 0x1b ? escapeEnd(bytes, at + 1) : at + utf8Width(bytes[at]!);
    if (end === undefined || end > bytes.length || end - at > limit) return;
    if (end - start > limit) {
      chunks.push(bytes.slice(start, at));
      start = at;
    }
    at = end;
  }
  if (start < bytes.length) chunks.push(bytes.slice(start));
  return chunks;
}
