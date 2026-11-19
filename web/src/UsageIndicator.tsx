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
  const [quota, setQuota] = useState<Quota | null>(null);
  const [revision, setRevision] = useState(0);
  const [checkResult, setCheckResult] = useState<string | null>("");
  const checkBaseline = useRef<number | undefined>(undefined);
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    activePane.current = paneId;
    checkBaseline.current = undefined;
    setSelection(null);
    setResetStatus("");
    setCheckResult("");
    setQuota(null);
  }, [paneId]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const abort = new AbortController();
    let fetching = false;
    const refresh = async () => {
      if (document.hidden || fetching) return;
      setNow(Date.now() / 1000);
      fetching = true;
      const baseline = checkBaseline.current;
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(8000)]);
      try {
        const value = await outputJson<Quota>(`usage?${new URLSearchParams({ pane: paneId })}`, signal);
        if (abort.signal.aborted) return;
        setQuota(previous =>
          previous?.accountKey && previous.accountKey === value.accountKey && (previous.observedAt ?? 0) > (value.observedAt ?? 0) ? previous : value);
        if (baseline !== undefined) {
          if (value.status !== "ok") setCheckResult("");
          else if ((value.observedAt ?? 0) > baseline) setCheckResult("Newer usage sample loaded.");
          else setCheckResult("No newer usage sample reported.");
        } else setCheckResult("");
      } catch {
        if (abort.signal.aborted) return;
        setQuota(previous => ({ ...previous, status: "Quota unavailable", windows: previous?.windows ?? [] }));
        if (baseline !== undefined) setCheckResult("Couldn’t check usage. Try again.");
      } finally {
        if (!abort.signal.aborted) checkBaseline.current = undefined;
        fetching = false;
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    return () => { abort.abort(); window.clearInterval(interval); document.removeEventListener("visibilitychange", refresh); };
  }, [paneId, revision]);
  const checkingUsage = checkResult === null;
  const checkUsage = () => {
    checkBaseline.current = quota?.observedAt ?? 0;
    setCheckResult(null);
    setRevision(value => value + 1);
  };
  const provider = quota?.provider === "claude" ? "Claude" : quota?.provider === "codex" ? "Codex" : "Usage";
  const claude = provider === "Claude";
  const credits = quota?.credits ?? [];
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
  const content = <div ref={panel} className={`usage-details${mobile ? " usage-details-mobile" : ""}${claude ? " usage-details-claude" : ""}`} style={mobile ? bounds : undefined}
    role="region" aria-label={`${provider} usage details`}>
      <strong>{quota?.account ?? (claude ? "Claude · current session" : "Account usage")}</strong>
      {!claude && quota?.profile && <div>{quota.profile} · profile allowance</div>}
      {quota?.windows?.map((w, i) => <div className="usage-window" key={i}>
        <div>{!claude && `${w.bucket} · `}{quotaLabel(w.minutes)}: {Math.round(w.remaining)}% remaining{quotaStale(quota, w, now) ? " · stale" : ""}</div>
        <meter min={0} max={100} value={w.remaining} aria-label={`${w.bucket} ${quotaLabel(w.minutes)} remaining`} />
        {!claude && <small>{w.resetsAt ? `Resets ${new Date(w.resetsAt * 1000).toLocaleString()}` : "Reset time not reported"}</small>}
      </div>)}
      {!claude && <>
        <div className="usage-window">
          {credits.length ? credits.map(credit => <div key={credit.bucket}>
            <strong>{credits.length > 1 && credit.bucket !== "codex" ? `Credits (${credit.bucket}):` : "Credits:"}</strong>{" "}
            {credit.unlimited ? "Unlimited" : credit.balance !== null ? Math.floor(Number(credit.balance)) :
              credit.hasCredits ? "Balance not reported" : "None available"}
          </div>) : <><strong>Credits:</strong> Balance not reported</>}
        </div>
        <div className="usage-window"><strong>Banked resets</strong>
          {quota?.bankedResets ? <>
            {quota.bankedResets.availableCount === 0 && !quota.bankedResets.credits?.length && <p>No banked resets.</p>}
            {!quota.accountKey && quota.bankedResets.availableCount > 0 && <p>Use the Codex Usage page to apply a reset for this account.</p>}
            {quota.bankedResets.credits?.map(credit => {
              const expiry = credit.expiresAt === null ? null : new Date(credit.expiresAt * 1000);
              return <div className="usage-reset" key={credit.id}>
                <div>{credit.title}</div>
                <div className="usage-reset-actions">
                  <button type="button" disabled={!canReset || resetBusy || credit.status !== "available" || credit.resetType !== "codexRateLimits" ||
                    credit.expiresAt !== null && credit.expiresAt <= now} onClick={() => chooseReset(credit)}>Use reset</button>
                  <small title={credit.expiryKnown ? expiry?.toLocaleString() : undefined}>
                    {!credit.expiryKnown ? "Expiry not reported" : !expiry ? "No expiry" :
                      `${expiry.getTime() <= now * 1000 ? "Expired" : "Expires"} ${expiry.toLocaleDateString()}`}
                  </small>
                </div>
              </div>;
            })}
            {quota.bankedResets.availableCount > (quota.bankedResets.credits?.length ?? 0) && <>
              <p>Individual details are not available for every reset.</p>
              <button type="button" disabled={!canReset || resetBusy} onClick={() => chooseReset(null)}>Use next available reset</button>
            </>}
          </> : <p>Banked resets not reported by the provider.</p>}
        </div>
      </>}
      {resetStatus && <p role="status">{resetStatus}</p>}
      {quota?.status !== "ok" && !checkResult && <p>{awaiting ? "Awaiting response" : quota?.status ?? "Loading quota…"}</p>}
      <div className="usage-actions">
        {claude && <a href="https://claude.ai/settings/usage" target="_blank" rel="noopener noreferrer">Open Claude usage</a>}
        {provider === "Codex" && <a href="https://chatgpt.com/codex/settings/usage" target="_blank" rel="noopener noreferrer">Manage Codex usage</a>}
        <button type="button" disabled={checkingUsage} onClick={checkUsage}>{checkingUsage ? "Checking…" : "Refresh"}</button>
      </div>
      {claude && <small className="usage-note">See remaining credits and resets on Claude’s website.</small>}
      <div className="usage-note" role="status">{checkingUsage ? "Checking the latest sample…" : checkResult}</div>
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
