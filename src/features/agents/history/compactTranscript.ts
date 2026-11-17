/**
 * The archive holds plain text from a full-screen terminal. Omit standalone
 * box drawing and block fragments, strip leading block artwork from text
 * lines, and keep one blank line between text.
 * Positions here are UTF-16 indices in the original page, as are the match
 * bounds passed by the reader after converting the server's byte offsets.
 */
export function compactTranscript(text: string, start: number, end: number) {
  let removed = 0;
  let removedBeforeMatch = 0;
  let previousLineEnd = -1;
  let keptBlank = false;
  const decoration = /^[\t \u00a0\u2500-\u259f]*\n|^[\t \u00a0\u2580-\u259f]*[\u2580-\u259f]+[\t \u00a0]*/gm;
  const compact = text.replace(decoration, (fragment: string, offset: number) => {
    const fragmentEnd = offset + fragment.length;
    const fullLine = fragment.endsWith('\n');
    if (offset !== previousLineEnd) keptBlank = false;
    previousLineEnd = fullLine ? fragmentEnd : -1;

    // A literal search can target the decoration itself. Keep its context
    // visible so the selected result can still be highlighted and scrolled to.
    if (offset < end && fragmentEnd > start) return fragment;
    if (fullLine && !keptBlank && fragment.trim() === '') {
      keptBlank = true;
      return fragment;
    }
    removed += fragment.length;
    if (fragmentEnd <= start) removedBeforeMatch += fragment.length;
    return '';
  });

  return { text: compact, start: start - removedBeforeMatch, end: end - removedBeforeMatch, changed: removed > 0 };
}
