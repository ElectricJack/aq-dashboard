import { isRecord } from "./adapters/contract";
import type { TerminalGrid } from "./interactiveTerminalClient";

function dimension(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function readyFrame(text: string) {
  const value: unknown = JSON.parse(text);
  const ready = isRecord(value) && value.kind === 'ready';
  if (!ready || !Number.isSafeInteger(value.server_time_ms)) {
    throw new Error('Invalid terminal response');
  }
  return value;
}

export function fixedGrid(frame: Record<string, unknown>): TerminalGrid | undefined {
  const { columns, rows } = frame;
  if (dimension(columns, 2, 500) && dimension(rows, 1, 300)) return { columns, rows };
}

export function rawChunks(bytes: Uint8Array) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 4096) chunks.push(bytes.slice(offset, offset + 4096));
  return chunks;
}

