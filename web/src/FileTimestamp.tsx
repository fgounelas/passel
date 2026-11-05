const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "long" });
const compactDate = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const olderDate = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function FileTimestamp({ mtime, directory = false }: { mtime: number; directory?: boolean }) {
  // Virtual navigation folders have no filesystem timestamp; never show 1970.
  if (!Number.isFinite(mtime) || mtime <= 0) return null;
  const date = new Date(mtime * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  const description = `Modified ${fullDate.format(date)}${directory ? ". Folder entry changes; not the latest edit inside it." : ""}`;
  return <time className="output-timestamp" dateTime={date.toISOString()} title={description} aria-label={description}>
    {(date.getFullYear() === new Date().getFullYear() ? compactDate : olderDate).format(date)}
  </time>;
}
