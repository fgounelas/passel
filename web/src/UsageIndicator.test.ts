import { expect, it } from "vitest";
import { awaitingClaudeQuota, compactQuotaWindow, mobileUsageBounds, primaryWindows, quotaLabel, quotaStale } from "./UsageIndicator";
it("fits mobile usage within portrait, landscape and keyboard/pinch visual viewports", () => {
  for (const viewport of [[320, 568, 0, 0, 568], [390, 844, 0, 0, 844], [700, 320, 0, 0, 320], [300, 280, 50, 90, 844]]) {
    const [width, height, left, top, layout] = viewport;
    const bounds = mobileUsageBounds(width, height, left, top, layout);
    expect(bounds.left).toBeGreaterThanOrEqual(left + 12);
    expect(bounds.left + bounds.width).toBeLessThanOrEqual(left + width - 12);
    expect(layout - bounds.bottom).toBeLessThanOrEqual(top + height - 12);
    expect(bounds.maxHeight).toBeLessThanOrEqual(height - 24);
  }
});
it("distinguishes fresh Claude quota from an unavailable observer without inventing a percentage", () => {
  expect(awaitingClaudeQuota({provider:"claude",status:"Quota not reported yet",windows:[]})).toBe(true);
  expect(awaitingClaudeQuota({provider:"claude",status:"Observer offline",windows:[]})).toBe(false);
  expect(awaitingClaudeQuota({provider:"codex",status:"Quota not reported yet",windows:[]})).toBe(false);
});
it("prioritizes the actual Codex bucket over unused model-specific allowances", () => {
  const other = {bucket:"codex_other",minutes:300,remaining:100,resetsAt:null};
  const main = {...other,bucket:"codex",minutes:10080,remaining:37};
  expect(primaryWindows({provider:"codex",status:"ok",windows:[other,main]})).toEqual([main]);
});
it("uses actual window durations, not assumptions", () => {
  expect(quotaLabel(10080)).toBe("Weekly");
  expect(quotaLabel(300)).toBe("5h");
  expect(quotaLabel(15)).toBe("15m");
});
it("marks reset boundaries, old samples, and provider errors stale", () => {
  const w = { bucket: "codex", minutes: 300, remaining: 50, resetsAt: 2000 };
  const q = { status: "ok", observedAt: 1000, windows: [w] };
  expect(quotaStale(q, w, 1200)).toBe(false);
  expect(quotaStale(q, w, 1601)).toBe(true);
  expect(quotaStale({...q, observedAt: 1900}, w, 2000)).toBe(true);
  expect(quotaStale({...q, status: "failed"}, w, 1200)).toBe(true);
});

it("shows the most depleted primary allowance in the compact badge", () => {
  const weekly = { bucket: "codex", minutes: 10080, remaining: 16, resetsAt: null };
  const hourly = { ...weekly, minutes: 300, remaining: 80 };
  const quota = { provider: "codex", status: "ok", windows: [{ ...weekly, bucket: "other", remaining: 0 }, hourly, weekly] };
  expect(compactQuotaWindow(quota)).toEqual(weekly);
  expect(compactQuotaWindow({ ...quota, windows: [weekly, { ...hourly, remaining: 5 }] })?.minutes).toBe(300);
  expect(compactQuotaWindow({ ...quota, windows: [] })).toBeUndefined();
});
