/** A readable local date and time; the exact recorded instant stays in `dateTime` and the `title` tooltip. */
export function Timestamp({ iso }: { iso: string }) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return <>{iso}</>;
  return <time dateTime={iso} title={iso}>{date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time>;
}
