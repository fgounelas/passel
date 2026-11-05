import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { BridgeHttpUrl } from "./bridgeApi";
import { apiErrorMessage } from "./bridgeApi";
import { fetchWithTimeout } from "./fetchWithTimeout";

type Project = { id: "danus" | "pharos"; path: string; status: "missing" | "installed" | "existing"; message?: string };
type Status = { projects: Project[]; startup_path: string };
type Props = { httpUrl?: BridgeHttpUrl; serverLabel?: string };
const ENDPOINT = "/api/project-files/setup";

async function request(httpUrl: BridgeHttpUrl, body?: object, signal?: AbortSignal, endpoint = ENDPOINT): Promise<unknown> {
  const response = await fetchWithTimeout(httpUrl(endpoint), {
    signal, timeoutMs: body && "cli" in body ? 300000 : body && "project" in body ? 135000 : endpoint.endsWith("/clis") ? 20000 : 10000,
    ...(body ? { method: "POST", headers: { "Content-Type": "application/json", "X-Herdr-Setup": "1" }, body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response) ?? `Setup is unavailable on this server (${response.status}).`);
  }
  return response.json();
}

function parseStatus(value: unknown): Status {
  const data = value as Partial<Status> | null;
  if (!data || typeof data.startup_path !== "string" || !Array.isArray(data.projects)
    || data.projects.length !== 2 || !data.projects.every(p => p && ["danus", "pharos"].includes(p.id)
      && typeof p.path === "string" && ["missing", "installed", "existing"].includes(p.status))) {
    throw new Error("This server returned invalid setup information.");
  }
  return data as Status;
}

function message(error: unknown) { return error instanceof Error ? error.message : "The server could not complete this request."; }

const CLI_DETAILS = {
  claude: { label: "Claude Code", url: "https://code.claude.com/docs/en/setup" },
  codex: { label: "Codex", url: "https://learn.chatgpt.com/docs/codex/cli" },
  agy: { label: "Gemini (Antigravity CLI)", url: "https://antigravity.google/docs/getting-started?tab=cli" },
};
type CliId = keyof typeof CLI_DETAILS;
type Cli = { id: CliId; installed: boolean; version: string | null; operation: "install" | "update" | null; error: string | null };
const CLI_ENDPOINT = ENDPOINT + "/clis";

function parseClis(value: unknown): Cli[] {
  const data = value as { clis?: Cli[] } | null;
  if (!data || !Array.isArray(data.clis) || data.clis.length !== 3
    || new Set(data.clis.map(cli => cli?.id)).size !== 3
    || !data.clis.every(cli => cli && Object.hasOwn(CLI_DETAILS, cli.id) && typeof cli.installed === "boolean"
      && (cli.version === null || typeof cli.version === "string") && [null, "install", "update"].includes(cli.operation)
      && (cli.error === null || typeof cli.error === "string"))) {
    throw new Error("This server returned invalid CLI setup information.");
  }
  return data.clis;
}

export function AgentCliSetupPanel({ httpUrl, serverLabel }: Props) {
  const [clis, setClis] = useState<Cli[]>([]);
  const [busy, setBusy] = useState<string | null>(httpUrl ? "check" : null);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    if (!httpUrl) return;
    const current = ++sequence.current;
    setBusy("check"); setError("");
    try {
      const data = parseClis(await request(httpUrl, undefined, undefined, CLI_ENDPOINT));
      if (sequence.current === current) setClis(data);
    } catch (caught) { if (sequence.current === current) setError(message(caught)); }
    finally { if (sequence.current === current) setBusy(null); }
  }, [httpUrl]);
  useEffect(() => { void refresh(); return () => { sequence.current += 1; }; }, [refresh]);
  const serverBusy = clis.some(cli => cli.operation !== null);
  useEffect(() => {
    if (!serverBusy || busy) return;
    const timer = window.setTimeout(() => { void refresh(); }, 2000);
    return () => window.clearTimeout(timer);
  }, [serverBusy, busy, clis, refresh]);

  const change = async (cli: Cli) => {
    if (!httpUrl || busy || serverBusy) return;
    const current = ++sequence.current;
    setBusy(cli.id); setError("");
    try {
      await request(httpUrl, { cli: cli.id, action: cli.installed ? "update" : "install" }, undefined, CLI_ENDPOINT);
      const data = parseClis(await request(httpUrl, undefined, undefined, CLI_ENDPOINT));
      if (sequence.current === current) setClis(data);
    } catch (caught) { if (sequence.current === current) setError(message(caught)); }
    finally { if (sequence.current === current) setBusy(null); }
  };

  return <div className="settings-section settings-section-flat">
    <div className="settings-label">AI assistants</div>
    <p className="settings-help">Install or update your chosen assistants on {serverLabel ?? "this server"}. Downloads can take a few minutes. After installation, open a new Shell session and run claude, codex or agy to sign in.</p>
    {!httpUrl ? <p className="settings-help">Connect to a server to check its assistants.</p> : null}
    {(Object.keys(CLI_DETAILS) as CliId[]).map(id => {
      const cli = clis.find(item => item.id === id);
      const { label, url } = CLI_DETAILS[id];
      const operation = cli?.operation ?? (busy === id ? cli?.installed ? "update" : "install" : null);
      return <div className="settings-project" key={id}>
        <strong><a href={url} target="_blank" rel="noreferrer">{label}</a></strong>
        <code>{id}</code>
        <p className="settings-help" role="status">{operation ? operation === "install" ? "Installing…" : "Updating…"
          : cli?.installed ? cli.version ? `Installed · ${cli.version}` : "Installed · version unavailable"
            : cli ? "Not installed" : busy ? "Checking…" : "Not checked"}</p>
        <div className="settings-project-actions">
          <button className="btn" type="button" disabled={!httpUrl || !!busy || serverBusy} onClick={() => { void refresh(); }} aria-label={`Check ${label} version`}>Check</button>
          <button className="btn btn-primary" type="button" disabled={!httpUrl || !!busy || serverBusy || !cli} onClick={() => { if (cli) void change(cli); }}>
            {cli?.installed ? "Update" : "Install"} {id === "agy" ? "agy" : label}
          </button>
        </div>
        {cli?.error ? <p className="settings-help" role="alert">{cli.error}</p> : null}
      </div>;
    })}
    {error ? <p className="settings-help" role="alert">{error}</p> : null}
  </div>;
}

export function ProjectSetupPanel({ httpUrl, serverLabel }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    if (!httpUrl) return;
    const current = ++sequence.current;
    setBusy("check"); setError("");
    try {
      const data = parseStatus(await request(httpUrl));
      if (sequence.current === current) setStatus(data);
    } catch (caught) { if (sequence.current === current) setError(message(caught)); }
    finally { if (sequence.current === current) setBusy(null); }
  }, [httpUrl]);
  useEffect(() => { void refresh(); return () => { sequence.current += 1; }; }, [refresh]);

  const install = async (id: Project["id"]) => {
    if (!httpUrl || busy) return;
    const current = ++sequence.current;
    setBusy(id); setError("");
    try {
      await request(httpUrl, { project: id });
      const data = parseStatus(await request(httpUrl));
      if (sequence.current === current) setStatus(data);
    } catch (caught) { if (sequence.current === current) setError(message(caught)); }
    finally { if (sequence.current === current) setBusy(null); }
  };

  return <div className="settings-section settings-section-flat">
    <div className="settings-label">Research projects</div>
    <p className="settings-help">{serverLabel ?? "This server"}: clone the latest Danus and Pharos source, then follow each project's README to configure its dependencies and agents.</p>
    {!httpUrl ? <p className="settings-help">Connect to a server to check its projects.</p> : null}
    {(["danus", "pharos"] as const).map(id => {
      const project = status?.projects.find(p => p.id === id);
      const label = id === "danus" ? "Danus" : "Pharos";
      return <div className="settings-project" key={id}>
        <strong><a href={`https://github.com/frenzymath/${label}`} target="_blank" rel="noreferrer">{label}</a></strong>
        <code>~/work/{id}</code>
        <p className="settings-help" role="status">{busy === id ? "Cloning…" : project?.status === "installed" ? "Installed" : project?.status === "existing" ? project.message ?? "Existing files" : project?.status === "missing" ? "Not installed" : busy ? "Checking…" : "Not checked"}</p>
        <div className="settings-project-actions">
          <button className="btn" type="button" disabled={!httpUrl || !!busy} onClick={() => { void refresh(); }} aria-label={`Check ${label} installation`}>Check</button>
          <button className="btn btn-primary" type="button" disabled={!httpUrl || !!busy || project?.status !== "missing"} onClick={() => { void install(id); }}>Install {label}</button>
        </div>
      </div>;
    })}
    {error ? <p className="settings-help" role="alert">{error}</p> : null}
  </div>;
}

export function TerminalStartupSetting({ httpUrl, serverLabel }: Props) {
  const id = useId();
  const [value, setValue] = useState("~/work");
  const [saved, setSaved] = useState("~/work");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(Boolean(httpUrl));
  const sequence = useRef(0);
  useEffect(() => {
    if (!httpUrl) return;
    const controller = new AbortController();
    const current = ++sequence.current;
    setBusy(true);
    void request(httpUrl, undefined, controller.signal).then(data => {
      if (sequence.current !== current) return;
      const path = parseStatus(data).startup_path;
      setValue(path); setSaved(path);
    }).catch(caught => { if (!controller.signal.aborted && sequence.current === current) setError(message(caught)); })
      .finally(() => { if (sequence.current === current) setBusy(false); });
    return () => { controller.abort(); sequence.current += 1; };
  }, [httpUrl]);

  const save = async (path: string) => {
    if (!httpUrl || busy || path.trim() === saved) return;
    const current = ++sequence.current;
    setBusy(true); setError(""); setStatus("Saving…");
    try {
      const data = await request(httpUrl, { startup_path: path.trim() }) as { startup_path?: unknown };
      if (typeof data?.startup_path !== "string") throw new Error("Invalid terminal settings response.");
      if (sequence.current === current) { setSaved(data.startup_path); setValue(data.startup_path); setStatus("Saved"); }
    } catch (caught) { if (sequence.current === current) { setError(message(caught)); setStatus(""); } }
    finally { if (sequence.current === current) setBusy(false); }
  };

  return <>
    <div className="settings-label">New sessions</div>
    <div className="settings-row">
      <label htmlFor={id}>Startup path</label>
      <input id={id} className="settings-select settings-path-input" value={value} spellCheck={false}
        disabled={!httpUrl || busy} onChange={event => { setValue(event.target.value); setStatus(""); setError(""); }}
        onBlur={() => { void save(value); }}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />
    </div>
    <p className="settings-help">New sessions opened in Passel on {serverLabel ?? "this server"} start here. Enter ~/work or an existing directory; press Enter or leave the field to apply.</p>
    {status ? <p className="settings-help" role="status">{status}</p> : null}
    {error ? <p className="settings-help" role="alert">{error}</p> : null}
    {!httpUrl ? <p className="settings-help">Connect to a server to change its startup path.</p> : null}
  </>;
}
