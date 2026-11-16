const LOGIN_ENDPOINTS = new Map([
  ["claude.ai", "/oauth/authorize"],
  ["console.anthropic.com", "/oauth/authorize"],
  ["platform.claude.com", "/oauth/authorize"],
  ["claude.com", "/cai/oauth/authorize"],
]);
const URL_PART = /^[A-Za-z0-9:/?[\]@!$&'()*+,;=._~%#-]+$/;

export function isClaudeLoginUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 8192 || !URL_PART.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && LOGIN_ENDPOINTS.get(url.hostname) === url.pathname
      && !url.username && !url.password && !url.port && !url.hash
      && url.searchParams.getAll("response_type").join() === "code"
      && ["client_id", "state", "code_challenge"].every(key => Boolean(url.searchParams.get(key)));
  } catch { return false; }
}

/** Claude wraps its URL with explicit newlines, so VT soft-wrap flags alone aren't enough. */
export function claudeLoginLink(lines: readonly string[]) {
  const bounded = lines.slice(-200);
  let heading = -1;
  bounded.forEach((line, index) => { if (/browser didn[’']t open\?/i.test(line)) heading = index; });
  if (heading < 0) return null;
  const start = bounded.findIndex((line, i) => i > heading && i <= heading + 8 && line.trim().startsWith("https://"));
  if (start < 0) return null;
  const parts: string[] = [];
  let end = start;
  for (; end < Math.min(bounded.length, start + 32); end++) {
    const part = bounded[end].trim();
    if (!part || !URL_PART.test(part)) break;
    parts.push(part);
  }
  const url = parts.join("");
  if (!isClaudeLoginUrl(url)) return null;
  const offset = lines.length - bounded.length;
  return {url, firstRow: start + offset, lastRow: end - 1 + offset};
}
