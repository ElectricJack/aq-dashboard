import { crc32 } from "node:zlib";
import { expect } from "@playwright/test";

function readChunk(bytes, offset) {
  expect(offset + 12).toBeLessThanOrEqual(bytes.length);
  const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
  expect(end).toBeLessThanOrEqual(bytes.length);
  const kind = bytes.toString("ascii", offset + 4, offset + 8);
  expect(["IHDR", "sRGB", "IDAT", "IEND"]).toContain(kind);
  expect(bytes.readUInt32BE(end - 4)).toBe(crc32(bytes.subarray(offset + 4, end - 4)));
  return { length, end, kind };
}

export function inputPngPolicy(bytes) {
  // Do not rewrite screenshots. Abort before admission if Chromium emits unsupported metadata.
  const kinds = []; let offset = 8, idat = false, afterIdat = false, srgb = false, ended = false;
  while (offset < bytes.length) {
    const { length, end, kind } = readChunk(bytes, offset);
    kinds.push(kind);
    if (kinds.length === 1) { expect(kind).toBe("IHDR"); expect(length).toBe(13); }
    else expect(kind).not.toBe("IHDR");
    if (kind === "sRGB") { expect(srgb || idat).toBe(false); expect(length).toBe(1); expect(bytes[offset + 8]).toBeLessThanOrEqual(3); srgb = true; }
    if (kind === "IDAT") { expect(afterIdat).toBe(false); idat = true; }
    else if (idat) afterIdat = true;
    if (kind === "IEND") { expect(length).toBe(0); expect(idat).toBe(true); expect(end).toBe(bytes.length); ended = true; }
    offset = end;
  }
  expect(ended).toBe(true); expect(bytes[26]).toBe(0); expect(bytes[27]).toBe(0);
  return kinds;
}
