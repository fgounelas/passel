export type ResetAttempt = { pane: string; accountKey: string; creditId: string | null; availableCount: number; requestId: string };
const KEY = "herdr-usage-reset-attempts";
let fallback: ResetAttempt[] = [];
let volatile = false;
function read(): ResetAttempt[] {
  if (volatile) return fallback;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw || raw.length > 100000) return [];
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((row): row is ResetAttempt => row &&
      typeof row.pane === "string" && typeof row.accountKey === "string" && /^[a-f0-9]{64}$/.test(row.accountKey) &&
      typeof row.requestId === "string" && /^[a-f0-9-]{36}$/.test(row.requestId) &&
      (row.creditId === null || typeof row.creditId === "string" && row.creditId.length <= 256) &&
      Number.isInteger(row.availableCount) && row.availableCount > 0).slice(-100) : [];
  } catch { return fallback; }
}
function write(rows: ResetAttempt[]) {
  fallback = rows;
  try { localStorage.setItem(KEY, JSON.stringify(rows)); } catch { volatile = true; }
}
export function resetAttempt(pane: string, accountKey: string, creditId: string | null, availableCount: number) {
  const rows = read();
  const previous = rows.find(row => row.accountKey === accountKey && row.creditId === creditId);
  if (previous) return {attempt: {...previous, pane}, retry: true};
  if (rows.length >= 100) throw new Error("Too many unconfirmed resets. Check provider usage before trying again.");
  const attempt = {pane, accountKey, creditId, availableCount, requestId: crypto.randomUUID()};
  write([...rows, attempt]);
  return {attempt, retry: false};
}
export function pendingResetAttempt(accountKey: string, creditId: string | null) {
  return read().find(row => row.accountKey === accountKey && row.creditId === creditId);
}
export function completeResetAttempt(requestId: string) { write(read().filter(row => row.requestId !== requestId)); }
