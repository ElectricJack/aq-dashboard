import { describe, expect, it } from 'vitest';
import { snapshotLines } from './terminalSnapshot';

const buffer = (lines: string[], baseY = 0) => ({ length: lines.length, baseY, getLine: (i: number) => i < lines.length ? { translateToString: (trim?: boolean) => trim ? lines[i]!.trimEnd() : lines[i]! } : undefined });

describe('snapshotLines', () => {
  it('keeps the visible screen rows and drops trailing blank rows', () => {
    expect(snapshotLines(buffer(['old', 'a  ', 'b', '', '  '], 1), 4)).toEqual(['a', 'b']);
  });
  it('returns an empty list for a screen with no observed output', () => {
    expect(snapshotLines(buffer(['', '']), 2)).toEqual([]);
  });
});
