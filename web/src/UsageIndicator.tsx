import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { outputJson } from "./projectFiles";
import { ConfirmDialog } from "./overlays";
import { completeResetAttempt, pendingResetAttempt, resetAttempt, type ResetAttempt } from "./usageResetAttempts";
import "./usageIndicator.css";

export type QuotaWindow = { bucket: string; minutes: number; remaining: number; resetsAt: number | null };
export type BankedReset = { id: string; title: string; status: string; resetType: string; expiresAt: number | null; expiryKnown: boolean };
export type Quota = { provider?: string; account?: string; accountKey?: string | null; profile?: string; observedAt?: number; status: string; windows: QuotaWindow[];
  credits?: { bucket: string; balance: string | null; hasCredits: boolean; unlimited: boolean }[];
  bankedResets?: { availableCount: number; credits: BankedReset[] | null } | null };
export function quotaLabel(minutes: number) {
  return minutes === 10080 ? "Weekly" : minutes % 1440 === 0 ? `${minutes / 1440}d` :
    minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}
export function quotaStale(quota: Quota, window: QuotaWindow, now: number) {
  return !quota.observedAt || now - quota.observedAt > 600 || quota.status !== "ok" ||
    (window.resetsAt !== null && now >= window.resetsAt);
}
export function primaryWindows(quota: Quota) {
  const main = quota.windows.filter(w => w.bucket === (quota.provider === "claude" ? "claude" : "codex"));
  return main.length ? main : quota.windows.slice(0, 1);
}

export function compactQuotaWindow(quota: Quota) {
  return primaryWindows(quota).reduce<QuotaWindow | undefined>((lowest, window) =>
    !lowest || window.remaining < lowest.remaining ? window : lowest, undefined);
}

export function awaitingClaudeQuota(quota: Quota | null) {
  return quota?.provider === "claude" && quota.windows.length === 0 &&
    (quota.status === "Quota not reported yet" || quota.status === "Waiting for Claude status line");
}

export function mobileUsageBounds(width: number, height: number, offsetLeft = 0, offsetTop = 0, layoutHeight = height) {
  const panelWidth = Math.min(360, Math.max(0, width - 24));
  return {left: offsetLeft + (width - panelWidth) / 2, bottom: Math.max(12, layoutHeight - offsetTop - height + 12),
    width: panelWidth, maxHeight: Math.max(0, Math.min(440, height * .7, height - 24))};
}

export default function UsageIndicator({ paneId }: { paneId: string }) {
  const popover = useRef<HTMLDetailsElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(() => window.innerWidth <= 820);
  const [bounds, setBounds] = useState(() => mobileUsageBounds(window.innerWidth, window.innerHeight));
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => {
      setMobile(window.innerWidth <= 820);
      setBounds(mobileUsageBounds(viewport?.width ?? window.innerWidth, viewport?.height ?? window.innerHeight,
        viewport?.offsetLeft ?? 0, viewport?.offsetTop ?? 0, window.innerHeight));
    };
    resize();
    window.addEventListener("resize", resize);
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    return () => { window.removeEventListener("resize", resize); viewport?.removeEventListener("resize", resize); viewport?.removeEventListener("scroll", resize); };
  }, []);
  const [selection, setSelection] = useState<{credit: BankedReset | null; retry: boolean; error?: string; attempt?: ResetAttempt; pane: string; accountKey: string; count: number; account: string} | null>(null);
  useEffect(() => {
    if (selection) return;
    const outside = (event: Event) => {
      const node = popover.current;
      if (node?.open && event.target instanceof Node && !node.contains(event.target) && !panel.current?.contains(event.target)) {
        node.open = false; setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      const node = popover.current;
      if (event.key !== "Escape" || !node?.open) return;
      const focusInside = node.contains(document.activeElement) || panel.current?.contains(document.activeElement);
      node.open = false; setOpen(false);
      if (focusInside) node.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [selection]);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetStatus, setResetStatus] = useState("");
  const resetting = useRef(false);
  const alive = useRef(true);
  const activePane = useRef(paneId);
  useEffect(() => { activePane.current = paneId; setSelection(null); setResetStatus(""); setQuota(null); }, [paneId]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    const abort = new AbortController();
    const refresh = () => {
      if (document.hidden) return;
      setNow(Date.now() / 1000);
      void outputJson<Quota>(`usage?${new URLSearchParams({ pane: paneId })}`, abort.signal)
        .then(value => { if (!abort.signal.aborted) setQuota(previous =>
          previous?.accountKey && previous.accountKey === value.accountKey && (previous.observedAt ?? 0) > (value.observedAt ?? 0) ? previous : value); })
        .catch(() => { if (!abort.signal.aborted) setQuota({ status: "Quota unavailable", windows: [] }); });
    };
    refresh();
    const interval = window.setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    return () => { abort.abort(); window.clearInterval(interval); document.removeEventListener("visibilitychange", refresh); };
  }, [paneId, revision]);
  const provider = quota?.provider === "claude" ? "Claude" : quota?.provider === "codex" ? "Codex" : "Usage";
  const compact = quota ? compactQuotaWindow(quota) : undefined;
  const stale = Boolean(quota && compact && quotaStale(quota, compact, now));
  const awaiting = awaitingClaudeQuota(quota);
  const compactLabel = compact ? `${provider} ${quotaLabel(compact.minutes)}: ${Math.round(compact.remaining)}% remaining${stale ? " (stale)" : ""}. Show usage details` : `${provider}: allowance unavailable. Show usage details`;
  const canReset = quota?.provider === "codex" && quota.status === "ok" && !!quota.accountKey &&
    !!quota.observedAt && now - quota.observedAt < 600 && (quota.bankedResets?.availableCount ?? 0) > 0;
  const chooseReset = (credit: BankedReset | null) => {
    if (!canReset || !quota?.accountKey || !quota.bankedResets) return;
    const attempt = pendingResetAttempt(quota.accountKey, credit?.id ?? null);
    setResetStatus(""); setSelection({credit, retry: !!attempt, attempt,
      pane: paneId, accountKey: quota.accountKey, count: quota.bankedResets.availableCount, account: quota.account ?? "this account"});
  };
  const consumeReset = async () => {
    if (resetting.current || !selection || !selection.retry && !canReset) return;
    if (selection.pane !== paneId || quota?.accountKey && selection.accountKey !== quota.accountKey) {
      setSelection(null); setResetStatus("The account changed. Review usage before resetting."); return;
    }
    resetting.current = true; setResetBusy(true); setResetStatus("");
    const pane = paneId;
    let attempt: ResetAttempt | undefined;
    try {
      if (selection.retry) {
        if (!selection.attempt) throw new Error("The previous attempt ID is unavailable. Check provider usage before starting another reset.");
        attempt = {...selection.attempt, pane};
      } else attempt = resetAttempt(pane, selection.accountKey, selection.credit?.id ?? null, selection.count).attempt;
      const response = await fetch("/api/project-files/usage/reset", {method: "POST", credentials: "same-origin",
        headers: {"Content-Type": "application/json", "X-Herdr-Conversation": "1"}, body: JSON.stringify(attempt), signal: AbortSignal.timeout(40000)});
      const result = await response.json() as {outcome?: string; quota?: Quota | null; error?: string};
      if (!response.ok) throw new Error(result.error || "Reset result is unknown. Retry the same attempt or check provider usage.");
      const messages: Record<string, string> = {reset: "Banked reset applied.", alreadyRedeemed: "This reset was already applied.",
        nothingToReset: "No usage window needs a reset. No reset was used.", noCredit: "No banked resets are available."};
      if (!result.outcome || !messages[result.outcome]) throw new Error("Reset result is unknown. Retry the same attempt or check provider usage.");
      completeResetAttempt(attempt.requestId);
      if (alive.current && activePane.current === pane) {
        if (result.quota) setQuota(result.quota);
        setResetStatus(messages[result.outcome]); setSelection(null); setNow(Date.now() / 1000);
      }
    } catch (cause) {
      if (alive.current && activePane.current === pane) {
        const message = cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "Reset result is unknown. Retry the same attempt or check provider usage.";
        setResetStatus(message);
        if (attempt) setSelection(previous => previous ? {...previous, retry: true, attempt, error: message} : previous);
      }
    } finally { resetting.current = false; if (alive.current) setResetBusy(false); }
  };
  const content = <div ref={panel} className={`usage-details${mobile ? " usage-details-mobile" : ""}`} style={mobile ? bounds : undefined}
    role="region" aria-label={`${provider} usage details`}>
      <strong>{quota?.account ?? "Account usage"}</strong>
      {quota?.profile && <div>{quota.profile} · profile allowance</div>}
      {quota?.windows?.map((w, i) => <div className="usage-window" key={i}>
        <div>{w.bucket} · {quotaLabel(w.minutes)}: {Math.round(w.remaining)}% remaining{quotaStale(quota, w, now) ? " · stale" : ""}</div>
        <meter min={0} max={100} value={w.remaining} aria-label={`${w.bucket} ${quotaLabel(w.minutes)} remaining`} />
        <small>{w.resetsAt ? `Resets ${new Date(w.resetsAt * 1000).toLocaleString()}` : "Reset time not reported"}</small>
      </div>)}
      <div className="usage-window"><strong>Credits</strong>
        {quota?.credits?.length ? quota.credits.map(credit => <div key={credit.bucket}>{credit.bucket}: {credit.unlimited ? "Unlimited" :
          credit.balance !== null ? `${credit.balance} remaining` : credit.hasCredits ? "Available; balance not reported" : "No credits available"}</div>) :
          <p>Credit balance not reported{quota?.provider === "claude" ? " by Claude Code" : " by the provider"}.</p>}
      </div>
      <div className="usage-window"><strong>Banked resets</strong>
        {quota?.bankedResets ? <>
          <p>{quota.bankedResets.availableCount} available</p>
          {!quota.accountKey && quota.bankedResets.availableCount > 0 && <p>Use the Codex Usage page to apply a reset for this account.</p>}
          {quota.bankedResets.credits?.map(credit => <div className="usage-reset" key={credit.id}>
            <div>{credit.title}</div><small>{!credit.expiryKnown ? "Expiry not reported" : credit.expiresAt === null ? "No expiry" :
              `${credit.expiresAt <= now ? "Expired" : "Expires"} ${new Date(credit.expiresAt * 1000).toLocaleString()}`}</small>
            <button type="button" disabled={!canReset || resetBusy || credit.status !== "available" || credit.resetType !== "codexRateLimits" ||
              credit.expiresAt !== null && credit.expiresAt <= now} onClick={() => chooseReset(credit)}>Use reset</button>
          </div>)}
          {quota.bankedResets.availableCount > (quota.bankedResets.credits?.length ?? 0) && <>
            <p>Individual details are not available for every reset.</p>
            <button type="button" disabled={!canReset || resetBusy} onClick={() => chooseReset(null)}>Use next available reset</button>
          </>}
        </> : <p>{quota?.provider === "claude" ? "Claude Code does not report banked resets or expiry dates." : "Banked resets not reported by the provider."}</p>}
      </div>
      {quota?.provider === "claude" && <a href="https://claude.ai/settings/usage" target="_blank" rel="noopener noreferrer">View credits / use a reset in Claude</a>}
      {quota?.provider === "codex" && <a href="https://chatgpt.com/codex/settings/usage" target="_blank" rel="noopener noreferrer">Manage Codex usage</a>}
      {resetStatus && <p role="status">{resetStatus}</p>}
      <p>{quota?.status === "ok" ? "Reported by the provider; shared across sessions using this account." : quota?.status ?? "Loading quota…"}</p>
      {quota?.observedAt && <small>Last observed {new Date(quota.observedAt * 1000).toLocaleString()}</small>}
      <p className="usage-note">Codex refreshes every 5 minutes. Claude updates after responses; missing limits are not estimated.</p>
      <button type="button" onClick={() => setRevision(v => v + 1)}>Refresh display</button>
    </div>;
  const confirmation = selection && <div className="usage-reset-confirmation"><ConfirmDialog title={selection.retry ? "Retry the same reset attempt?" : "Use one banked reset?"}
    message={selection.retry ? `${selection.error ? `${selection.error}\n\n` : ""}The previous result was not confirmed. Retrying uses the same request ID, so it cannot redeem another reset.` :
      `This uses one reset for ${selection.account}, shared across its sessions. It cannot be undone.`}
    confirmLabel={selection.retry ? "Retry same attempt" : "Use reset"} danger={false} busy={resetBusy}
    onCancel={() => { if (!resetting.current) setSelection(null); }} onConfirm={() => void consumeReset()} /></div>;
  return <><details ref={popover} className="usage-indicator" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary title={compactLabel} aria-label={compactLabel} aria-expanded={open}>
      <span className="usage-summary-compact" data-stale={stale} aria-hidden="true">{compact ? `${Math.round(compact.remaining)}%${stale ? "*" : ""}` : "—"}</span>
      <span className="usage-summary-full">{provider}</span>
      {quota?.windows?.length ? primaryWindows(quota).map((w, i) => <span className="usage-summary-full" key={i} data-stale={quotaStale(quota, w, now)}>
        {w.bucket !== "codex" && w.bucket !== "claude" ? `${w.bucket} ` : ""}{quotaLabel(w.minutes)} {Math.round(w.remaining)}%{quotaStale(quota, w, now) ? " (stale)" : " left"}
      </span>) : <span className="usage-summary-full">{awaiting ? "Awaiting response" : "—"}</span>}
    </summary>
    {!mobile && content}
  </details>{mobile && open && createPortal(content, document.body)}{mobile ? createPortal(confirmation, document.body) : confirmation}</>;
}
