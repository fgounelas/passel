import { useEffect, useRef, useState } from "react";
import { Folder } from "lucide-react";
import { ActionMenu, useLongPress } from "./overlays";
import { outputJson, type OutputEntry } from "./projectFiles";
import { projectFolderChoiceKey, projectFolderChoices } from "./projectFolderChoices";

export function referencedProjects(text: string): Set<string> {
  return new Set([...text.matchAll(/runtime\/projects\/([^/\s"'`<>()[\]{}:,;]+)/g)]
    .map(match => match[1].replace(/\.+$/, "")).filter(Boolean));
}

export async function projectFolders(pane: string, cwd: string, signal: AbortSignal,
  options: { preferred?: string; choose?: boolean } = {}): Promise<string[]> {
  const list = async (path: string) => (await outputJson<{ entries: OutputEntry[] }>(
    `list?${new URLSearchParams({root: "work", path})}`, signal)).entries.filter(e => e.directory);
  const relative = cwd.match(/\/work\/(.+)/)?.[1] ?? "";
  const workspace = relative.split("/")[0];
  const roots = await list("");
  const ordinary = (name: string) => !/danus|pharos|rethlas/i.test(name) && name !== "uploads";
  if (!options.choose && roots.some(entry => entry.name === workspace) && ordinary(workspace)) {
    try { await list(relative); return [relative]; }
    catch (error) { if (signal.aborted) throw error; }
  }
  const scoped = roots.some(e => e.name === workspace) ? [workspace] : roots.filter(e => e.name !== "uploads").slice(0, 32).map(e => e.name);
  const folders: string[] = [];
  for (const root of scoped) {
    if (ordinary(root)) { folders.push(root); continue; }
    try { folders.push(...(await list(`${root}/runtime/projects`)).map(e => `${root}/runtime/projects/${e.name}`)); }
    catch (error) { if (signal.aborted) throw error; }
  }
  if (options.choose) return folders;
  const exact = folders.find(path => relative === path || relative.startsWith(`${path}/`));
  if (exact) return [exact];
  if (options.preferred && folders.includes(options.preferred)) return [options.preferred];
  if (folders.length < 2) return folders;
  let data: { status: string; messages: { text: string }[] };
  try {
    data = await outputJson(`conversation?${new URLSearchParams({pane})}`, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    // Conversation references refine available choices; they are not required
    // to open a project whose folder has already been validated.
    return folders;
  }
  const names = referencedProjects((data.messages ?? []).slice(-300).map(m => m.text.slice(0, 64_000)).join("\n").slice(-500_000));
  const matches = folders.filter(path => names.has(path.split("/").at(-1)!));
  return matches.length ? matches : folders;
}

export function ProjectFolderButton({ bridgeId, terminalId, paneId, cwd, enabled, onOpen }: {
  bridgeId: string; terminalId?: string; paneId?: string; cwd: string; enabled: boolean; onOpen: (path: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [choices, setChoices] = useState<{ paths: string[]; x: number; y: number } | null>(null);
  const request = useRef<AbortController | null>(null);
  const choiceKey = projectFolderChoiceKey(bridgeId, terminalId ?? paneId ?? "", cwd);
  const activeKey = useRef<string | null>(choiceKey);
  useEffect(() => {
    activeKey.current = choiceKey; setBusy(false); setError(""); setChoices(null);
    return () => { activeKey.current = null; request.current?.abort(); };
  }, [paneId, choiceKey, enabled]);
  const open = (x: number, y: number, choose = false) => {
    if (activeKey.current !== choiceKey || !enabled || !paneId || busy) return;
    request.current?.abort();
    const abort = new AbortController(); request.current = abort;
    setBusy(true); setError(""); setChoices(null);
    void projectFolders(paneId, cwd, AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]), {
      preferred: projectFolderChoices.get(choiceKey), choose,
    }).then(paths => {
      if (abort.signal.aborted) return;
      if (paths.length === 1) { projectFolderChoices.set(choiceKey, paths[0]); onOpen(paths[0]); }
      else if (paths.length) setChoices({ paths, x, y });
      else setError("No project folders are available for this pane.");
    }).catch(() => { if (!abort.signal.aborted) setError("Could not find the project folder. Try again."); })
      .finally(() => { if (!abort.signal.aborted) setBusy(false); });
  };
  const press = useLongPress((x, y) => open(x, y, true), (x, y) => open(x, y));
  return <>
    <button className="icon-btn" type="button" aria-label="Open Files" title={error || "Open project folder in Files. Right-click or long-press to choose another folder."}
      disabled={!enabled || !paneId || busy} aria-busy={busy} aria-haspopup="menu" aria-expanded={!!choices}
      {...press}><Folder size={18} /></button>
    {error && <span className="conversation-hint" role="status">{error}</span>}
    {choices && <ActionMenu x={choices.x} y={choices.y} title="Choose project folder"
      items={choices.paths.map(path => ({key: path, label: path}))} onClose={() => setChoices(null)}
      onPick={path => { projectFolderChoices.set(choiceKey, path); onOpen(path); setChoices(null); }} />}
  </>;
}
