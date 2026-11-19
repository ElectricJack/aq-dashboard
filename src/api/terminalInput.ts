/** Size of one escape-prefixed keyboard report. Incomplete reports have no
 * boundary, including ESC by itself. Escape has its own explicit key action. */
function escapeEnd(bytes: Uint8Array, start: number): number | undefined {
  const prefix = bytes[start];
  let end = start + 1;
  if (prefix === 0x5b || prefix === 0x4f) {
    while (bytes[end]! >= 0x30 && bytes[end]! <= 0x3f) end++;
    while (bytes[end]! >= 0x20 && bytes[end]! <= 0x2f) end++;
    if (!(bytes[end]! >= 0x40 && bytes[end]! <= 0x7e)) return;
    if (prefix === 0x5b && end === start + 1 && bytes[end] === 0x4d) {
      const coordinates = bytes.subarray(end + 1, end + 4);
      return coordinates.length === 3 && !coordinates.includes(0x1b) ? end + 4 : undefined;
    }
    return end + 1;
  }
  if (prefix === 0x5d || prefix === 0x50 || prefix === 0x58 || prefix === 0x5e || prefix === 0x5f) {
    for (; end < bytes.length; end++) {
      if (prefix === 0x5d && bytes[end] === 7) return end + 1;
      if (bytes[end] === 0x1b) return bytes[end + 1] === 0x5c ? end + 2 : undefined;
    }
    return;
  }
  if (prefix === undefined || prefix === 0x1b) return;
  if (prefix >= 0x20 && prefix <= 0x2f) {
    while (bytes[end]! >= 0x20 && bytes[end]! <= 0x2f) end++;
    if (bytes[end]! >= 0x30 && bytes[end]! <= 0x7e) return end + 1;
    return;
  }
  const width = utf8Width(prefix);
  if (start + width <= bytes.length) return start + width;
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
