import { useDocumentPrefs } from "./documentPrefs";
import { FileTimestamp } from "./FileTimestamp";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";
import { outputJson } from "./projectFiles";
import type { OutputEntry } from "./projectFiles";

type Listing = { revision?: number; entries?: OutputEntry[]; error?: string };
type Row = { entry: OutputEntry; path: string; parent: string; depth: number; open: boolean };
const expansionKey = (root: string) => `herdr-files-expanded:${root}`;
function readExpanded(root: string, remember: boolean): Set<string> {
  try {
    const saved: unknown = JSON.parse((remember ? localStorage.getItem(expansionKey(root)) ?? sessionStorage.getItem(expansionKey(root)) : sessionStorage.getItem(expansionKey(root))) ?? "[]");
    return new Set(Array.isArray(saved) ? saved.filter((p): p is string => typeof p === "string" && p.length < 2000).slice(0, 500) : []);
  } catch { return new Set(); }
}

export function OutputFileTree({ root, selectedPath, reveal, collapse, onPreview, onMenu, revision = 0, active = true }: {
  root: string; selectedPath?: string; revision?: number; active?: boolean;
  reveal: { path: string; token: number; directory?: boolean } | null; collapse: number;
  onPreview: (path: string) => void;
  onMenu: (path: string, name: string, x: number, y: number, directory: boolean) => void;
}) {
  const { rememberFolders } = useDocumentPrefs();
  const [expanded, setExpanded] = useState(() => readExpanded(root, rememberFolders));
  const [listings, setListings] = useState<Record<string, Listing>>({});
  const [focused, setFocused] = useState("");
  const pending = useRef(new Map<string, AbortController>());
  const tree = useRef<HTMLDivElement>(null);
  const revealed = useRef<number | null>(null);
  const previousCollapse = useRef(collapse);
  useEffect(() => {
    const requests = pending.current;
    return () => { requests.forEach(abort => abort.abort()); requests.clear(); };
  }, []);
  useEffect(() => {
    try {
      const value = JSON.stringify([...expanded].slice(0, 500));
      sessionStorage.setItem(expansionKey(root), value);
      if (rememberFolders) localStorage.setItem(expansionKey(root), value);
      else localStorage.removeItem(expansionKey(root));
    } catch { /* private mode */ }
  }, [expanded, root, rememberFolders]);
  useEffect(() => {
    if (previousCollapse.current === collapse) return;
    previousCollapse.current = collapse;
    setExpanded(new Set());
  }, [collapse]);
  useEffect(() => {
    if (!reveal) return;
    const parts = reveal.path.split("/");
    setExpanded(current => new Set([...current, ...parts.slice(0, reveal.directory ? undefined : -1).map((_, i) => parts.slice(0, i + 1).join("/"))]));
  }, [reveal]);
  useEffect(() => {
    if (!active) return;
    // Traverse known, expanded branches only. A saved descendant does not load
    // until its parents are expanded again. Limit simultaneous folder reads.
    const needed: string[] = [];
    const visit = (path: string) => {
      if (!listings[path] || listings[path].revision !== revision) needed.push(path);
      for (const entry of listings[path]?.entries ?? []) {
        const full = [path, entry.name].filter(Boolean).join("/");
        if (entry.directory && expanded.has(full)) visit(full);
      }
    };
    visit("");
    for (const path of needed) {
      if (pending.current.size >= 4) break;
      if (pending.current.has(path)) continue;
      const abort = new AbortController();
      pending.current.set(path, abort);
      void outputJson<{ entries: OutputEntry[] }>(`list?${new URLSearchParams({ root, path })}`, abort.signal)
        .then(result => {
          if (!abort.signal.aborted) setListings(current => ({ ...current, [path]: { entries: result.entries, revision } }));
        }).catch(() => {
          if (!abort.signal.aborted) setListings(current => ({ ...current, [path]: { ...current[path], error: "Folder unavailable. Try Refresh.", revision } }));
        }).finally(() => { if (pending.current.get(path) === abort) pending.current.delete(path); });
    }
  }, [expanded, listings, root, revision, active]);

  const rows: Row[] = [];
  const walk = (parent: string, depth: number) => {
    const entries = [...(listings[parent]?.entries ?? [])].sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const entry of entries) {
      const path = [parent, entry.name].filter(Boolean).join("/");
      const open = entry.directory && expanded.has(path);
      rows.push({ entry, path, parent, depth, open });
      if (open) walk(path, depth + 1);
    }
  };
  walk("", 1);
  const focusPath = (path: string) => {
    const element = [...(tree.current?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]') ?? [])].find(el => el.dataset.path === path);
    element?.focus();
    return element;
  };
  useEffect(() => {
    if (!reveal || revealed.current === reveal.token) return;
    const element = [...(tree.current?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]') ?? [])].find(el => el.dataset.path === reveal.path);
    if (element) {
      element.focus(); element.scrollIntoView?.({ block: "nearest" }); revealed.current = reveal.token;
    }
  }, [listings, expanded, reveal]);
  const toggle = (path: string, open: boolean) => setExpanded(current => {
    const next = new Set(current); if (open) next.add(path); else next.delete(path); return next;
  });
  const tabPath = rows.some(row => row.path === focused) ? focused : rows[0]?.path;
  return <div ref={tree} className="output-tree" role="tree" aria-label="Output files">
    {!listings[""] && <p role="status">Loading files…</p>}
    {listings[""]?.error && <p role="alert">{listings[""].error}</p>}
    {listings[""]?.entries && !rows.length && <p>No output files.</p>}
    {rows.map((row, index) => <div key={row.path} role="none">
      <button className="output-entry" role="treeitem" data-path={row.path} aria-level={row.depth}
        aria-expanded={row.entry.directory ? row.open : undefined} aria-selected={selectedPath === row.path}
        tabIndex={tabPath === row.path ? 0 : -1} onFocus={() => setFocused(row.path)}
        title={row.path} style={{ paddingLeft: 4 + (row.depth - 1) * 14 }}
        onClick={() => row.entry.directory ? toggle(row.path, !row.open) : onPreview(row.path)}
        onContextMenu={event => {
          event.preventDefault(); event.currentTarget.focus();
          onMenu(row.path, row.entry.name, event.clientX, event.clientY, row.entry.directory);
        }}
        onKeyDown={event => {
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault(); event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect(); onMenu(row.path, row.entry.name, rect.left, rect.bottom, row.entry.directory); return;
          }
          if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          if (event.key === "ArrowDown") focusPath(rows[Math.min(index + 1, rows.length - 1)].path);
          if (event.key === "ArrowUp") focusPath(rows[Math.max(0, index - 1)].path);
          if (event.key === "Home") focusPath(rows[0].path);
          if (event.key === "End") focusPath(rows[rows.length - 1].path);
          if (event.key === "ArrowLeft") { if (row.open) toggle(row.path, false); else focusPath(row.parent); }
          if (event.key === "ArrowRight" && row.entry.directory) {
            if (!row.open) toggle(row.path, true); else if (rows[index + 1]?.parent === row.path) focusPath(rows[index + 1].path);
          }
        }}>
        {row.entry.directory ? <>{row.open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{row.open ? <FolderOpen size={14} /> : <Folder size={14} />}</> : <><span className="output-tree-indent" /><FileText size={14} /></>}
        <span className="output-tree-name">{row.entry.name}</span>
        <FileTimestamp mtime={row.entry.mtime} directory={row.entry.directory} />
      </button>
      {row.open && !listings[row.path] && <p className="output-tree-status" role="status">Loading…</p>}
      {row.open && listings[row.path]?.error && <p className="output-tree-status" role="alert">{listings[row.path].error}</p>}
      {row.open && listings[row.path]?.entries?.length === 0 && <p className="output-tree-status">Empty folder</p>}
    </div>)}
  </div>;
}
