/** The minimal xterm buffer surface the snapshot reads (xterm's IBuffer satisfies it). */
export interface SnapshotBuffer { length: number; baseY: number; getLine(y: number): { translateToString(trimRight?: boolean): string } | undefined }

/** U11: the rows on screen at the moment observation stopped, as plain text.
 * Text only: no escape sequences are kept, so the frozen view cannot drive a renderer. */
export function snapshotLines(buffer: SnapshotBuffer, rows: number): string[] {
  const lines: string[] = [];
  for (let y = buffer.baseY; y < Math.min(buffer.length, buffer.baseY + rows); y++) lines.push(buffer.getLine(y)?.translateToString(true) ?? '');
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  return lines;
}
