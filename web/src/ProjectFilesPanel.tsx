import { documentPositionKey, useReadingPosition } from "./documentPosition";
import { useDocumentSelection } from "./documentSelection";
import { FileTimestamp } from "./FileTimestamp";
import { useDocumentPrefs } from "./documentPrefs";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { FileUploadControl } from "./FileUploadControl";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { fullOutputPath, outputJson, outputUrl, outputPreviewKind } from "./projectFiles";
import type { OutputEntry } from "./projectFiles";
import { OutputFileTree } from "./OutputFileTree";
import { normalizeMarkdownMath } from "./markdownMath";
import { splitFactMarkdown, remarkFactNotation } from "./factMarkdown";
import { ActionMenu, ConfirmDialog } from "./overlays";
import "./projectFiles.css";
const PdfViewer = lazy(() => import("./OutputPdfViewer"));

function FilePreview({ root, path, version, onSelect }: { root: string; path: string; version: number; onSelect: (path: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");
  const prefs = useDocumentPrefs();
  const [mode, setMode] = useState(() => path.toLowerCase().endsWith(".md") ? prefs.markdownMode : path.toLowerCase().endsWith(".tex") ? "source" : "preview");
  const [matchingPdf, setMatchingPdf] = useState<string | null>(null);
  const kind = outputPreviewKind(path);
  const pdf = kind === "pdf";
  const tex = kind === "tex";
  const plain = kind === "text";
  const djvu = path.toLowerCase().endsWith(".djvu");
  const image = /\.(png|jpe?g)$/i.test(path);
  const downloadOnly = kind === "download";
  const fact = useMemo(() => text ? splitFactMarkdown(path, text) : null, [path, text]);
  const markdown = useMemo(() => !pdf && !tex && !plain && text ? normalizeMarkdownMath(fact?.body ?? text) : "", [pdf, tex, plain, text, fact]);
  const url = `${outputUrl(root, path)}&v=${version}`;
  const [documentRoot, setDocumentRoot] = useState<HTMLDivElement | null>(null);
  useDocumentSelection(documentRoot);
  useReadingPosition(documentRoot, `${documentPositionKey(url)}:${mode}`, text !== null && !error, prefs.rememberPosition);
  useEffect(() => {
    if (pdf || downloadOnly) return;
    const abort = new AbortController();
    void fetch(url, { signal: abort.signal, cache: "no-store" }).then(async r => {
      if (!r.ok) throw new Error(r.status === 413 ? "Too large to preview; use Download." : "File unavailable. Try Refresh.");
      return r.text();
    }).then(setText).catch(e => { if (!abort.signal.aborted) setError(String(e.message)); });
    if (tex) {
      const parent = path.slice(0, path.lastIndexOf("/"));
      const candidate = path.replace(/\.tex$/i, ".pdf");
      void outputJson<{ entries: OutputEntry[] }>(`list?${new URLSearchParams({ root, path: parent })}`, abort.signal)
        .then(r => { if (r.entries.some(e => !e.directory && `${parent}/${e.name}` === candidate)) setMatchingPdf(candidate); })
        .catch(() => {});
    }
    return () => abort.abort();
  }, [pdf, downloadOnly, tex, path, root, url]);
  return <section className="output-preview" aria-label="File preview">
    {!pdf && !downloadOnly && !plain && (!tex || matchingPdf) && <div className="output-controls">
      {!tex && <>
        <button aria-pressed={mode === "preview"} onClick={() => setMode("preview")}>Rendered</button>
        <button aria-pressed={mode === "source"} onClick={() => setMode("source")}>Source</button>
      </>}
      {matchingPdf && <button onClick={() => onSelect(matchingPdf)}>View matching PDF</button>}
    </div>}
    {downloadOnly ? <p className="output-hint">{image ? "Image" : djvu ? "DjVu" : "File"} preview is unavailable. Use Download to open this file locally.</p> : pdf ? <Suspense fallback={<p>Loading viewer…</p>}><PdfViewer url={url} /></Suspense> :
      <div className="output-document" ref={setDocumentRoot} tabIndex={0} role="region" aria-label="Document contents"><div className={`output-reading-content${fact && mode === "preview" ? " output-fact" : ""}`}>{error ? <p role="alert">{error}</p> : text === null ? <p role="status">Loading…</p> :
        (plain || tex || mode === "source") ? <pre>{text}</pre> :
          <>
          {fact && <details className="output-fact-details"><summary>Fact details</summary><pre>{fact.metadata}</pre></details>}
          <ReactMarkdown skipHtml remarkPlugins={fact ? [remarkGfm, remarkMath, remarkFactNotation] : [remarkGfm, remarkMath]}
            rehypePlugins={[[rehypeKatex, { trust: false, strict: "ignore", maxExpand: 200, maxSize: 20 }]]}
            components={{ img: ({ alt }) => <span>[Image: {alt ?? "omitted"}]</span>,
              a: ({ href, children }) => /^https?:\/\//i.test(href ?? "") ? <a href={href} target="_blank" rel="noreferrer noopener">{children}</a> : <span>{children}</span> }}
          >{markdown}</ReactMarkdown></>}</div></div>}
  </section>;
}

export type OutputSelection = { root: string; path: string; version: number };

export function OutputViewerPanel({ file, onClose, onSelect, width, onWidth }: {
  file: OutputSelection; onClose: () => void; onSelect: (file: OutputSelection) => void;
  width: number; onWidth: (width: number) => void;
}) {
  const resize = (x: number) => onWidth(Math.max(320, Math.min(1000, window.innerWidth - 240, window.innerWidth - x)));
  return <aside className="project-files" aria-label="Document viewer" onKeyDown={e => {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
  }}>
    <div className="output-resizer" role="separator" aria-label="Resize document viewer" aria-orientation="vertical" tabIndex={0}
      aria-valuenow={width} aria-valuemin={320} aria-valuemax={1000}
      onKeyDown={e => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); onWidth(Math.max(320, Math.min(1000, width + (e.key === "ArrowLeft" ? 24 : -24)))); } }}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); resize(e.clientX); }}
      onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) resize(e.clientX); }} />
    <header className="output-controls output-file-heading"><strong title={file.path}>{file.path.split("/").at(-1)}</strong>
      <a href={outputUrl(file.root, file.path, true)} download>Download</a>
      <button onClick={() => onSelect({ ...file, version: file.version + 1 })} aria-label="Refresh document">↻</button>
      <button onClick={onClose} aria-label="Collapse document viewer" title="Collapse document viewer">✕</button>
    </header>
    <FilePreview key={`${file.root}/${file.path}/${file.version}`} {...file}
      onSelect={path => onSelect({ ...file, path })} />
  </aside>;
}

export default function ProjectFilesPanel({ onPreview, selected, active = true, onDeleted, externalReveal }: {
  externalReveal?: { path: string; token: number; directory?: boolean } | null;
  onPreview: (file: OutputSelection) => void; selected: OutputSelection | null; active?: boolean; onDeleted?: (path: string) => void;
}) {
  const [deleteFile, setDeleteFile] = useState<{ path: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const removeUpload = async () => {
    if (!deleteFile || deleting) return;
    setDeleting(true); setDeleteError("");
    try {
      const response = await fetch(`/api/project-files/upload?${new URLSearchParams({ name: deleteFile.name })}`, {
        method: "DELETE", headers: { "X-Herdr-Upload": "1" }, credentials: "same-origin",
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || `Delete failed (${response.status}).`);
      onDeleted?.(deleteFile.path); setDeleteFile(null); setVersion(v => v + 1);
    } catch (failure) { setDeleteError(String((failure as Error).message)); }
    finally { setDeleting(false); }
  };
  const [root, setRoot] = useState("");
  const [rootPaths, setRootPaths] = useState<Record<string, string>>({});
  const [copyStatus, setCopyStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [results, setResults] = useState<(OutputEntry & { path: string })[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [reveal, setReveal] = useState<{ path: string; token: number; directory?: boolean } | null>(null);
  const [collapse, setCollapse] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!externalReveal) return;
    setRoot("work"); setFilter(""); setReveal(externalReveal); setVersion(value => value + 1);
  }, [externalReveal]);
  useEffect(() => {
    if (!active) return;
    const refresh = () => { if (!document.hidden) setVersion(v => v + 1); };
    const timer = window.setInterval(refresh, 5000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", refresh); };
  }, [active]);
  const [fileMenu, setFileMenu] = useState<{ path: string; name: string; x: number; y: number; directory: boolean } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void outputJson<{ roots: string[]; paths?: Record<string, string> }>("roots", abort.signal).then(r => {
      if (!abort.signal.aborted) { setRoot(r.roots[0] ?? ""); setRootPaths(r.paths ?? {}); }
    })
      .catch(() => { if (!abort.signal.aborted) setError("Project files are unavailable on this server."); });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    if (!active) { setLoading(false); return; }
    if (!root || !filter.trim()) { setResults([]); setTruncated(false); setLoading(false); if (root) setError(""); return; }
    const abort = new AbortController();
    setLoading(true); setError("");
    const timer = setTimeout(() => {
      void outputJson<{ entries: (OutputEntry & { path: string })[]; truncated: boolean }>(
        `search?${new URLSearchParams({ root, q: filter.trim() })}`, abort.signal)
        .then(result => { if (!abort.signal.aborted) { setResults(result.entries); setTruncated(result.truncated); setLoading(false); } })
        .catch(() => { if (!abort.signal.aborted) { setLoading(false); setError("Search unavailable. Try again or Refresh."); } });
    }, 300);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [root, filter, version, active]);
  const showMenu = (path: string, name: string, x: number, y: number, directory: boolean) => {
    setCopyStatus(null); setFileMenu({ path, name, x, y, directory });
  };
  const copyPath = async (path: string) => {
    try {
      const full = fullOutputPath(rootPaths[root], path);
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable. Check browser permissions and try again.");
      await navigator.clipboard.writeText(full);
      setCopyStatus({ text: "Full path copied." });
    } catch (failure) { setCopyStatus({ text: String((failure as Error).message), error: true }); }
  };
  const revealFile = () => {
    if (!selected) return;
    setRoot(selected.root); setFilter("");
    setReveal({ path: selected.path, token: Date.now() });
  };
  return <FileUploadControl onUploaded={path => {
    setVersion(v => v + 1); setFilter(""); setReveal({ path, token: Date.now() });
  }}>{upload => <section className="files-browser" aria-label="Files" onKeyDown={e => e.stopPropagation()}
    {...upload.dropProps}>
    {upload.input}
    <header className="output-controls files-toolbar">
      <span className="files-root-label" aria-label="File browser root" tabIndex={0} aria-haspopup="menu"
        onContextMenu={event => { event.preventDefault(); event.currentTarget.focus(); showMenu('', '~/work', event.clientX, event.clientY, true); }}
        onKeyDown={event => {
          if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
          event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); showMenu('', '~/work', rect.left, rect.bottom, true);
        }}>~/work</span>
      <input className="output-filter" type="search" aria-label="Search filenames" placeholder="Search filenames…" maxLength={200}
        value={filter} onChange={e => setFilter(e.target.value)} />
      {selected && <>
        <button onClick={revealFile} aria-label="Reveal current file" title="Reveal current file">⌖</button>
        <button onClick={() => onPreview(selected)} aria-label="Open document viewer" title="Open document viewer">▤</button>
      </>}
      {upload.button}
      <button onClick={() => setVersion(v => v + 1)} aria-label="Refresh project files" title="Refresh project files">↻</button>
      <button onClick={() => { setFilter(""); setReveal(null); setCollapse(value => value + 1); }} aria-label="Collapse all folders" title="Collapse all folders">⊟</button>
    </header>
    {upload.status}
    {copyStatus && <p className="output-upload-status" role={copyStatus.error ? "alert" : "status"}>{copyStatus.text}</p>}
    {root && <div className="output-tree-container" hidden={Boolean(filter.trim())}>
      <OutputFileTree key={root} root={root} revision={version} active={active && !filter.trim()} selectedPath={reveal?.path ?? (selected?.root === root ? selected.path : undefined)}
        reveal={reveal} collapse={collapse} onPreview={path => { setReveal(null); onPreview({ root, path, version }); }} onMenu={showMenu} />
    </div>}
    {filter.trim() ? <div className="output-tree" role="list" aria-label="Filename search results">
      {loading && <p role="status">Searching ~/work…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && !results.length && <p>No matching filenames.</p>}
      {truncated && <p role="status">Results limited. Refine your search to find more.</p>}
      {results.map(entry => <div key={entry.path} role="listitem">
        <button className="output-entry output-search-result" title={entry.path}
          aria-pressed={selected?.root === root && selected.path === entry.path}
          onClick={() => onPreview({ root, path: entry.path, version })}
          onContextMenu={event => { event.preventDefault(); event.currentTarget.focus(); showMenu(entry.path, entry.name, event.clientX, event.clientY, entry.directory); }}
          onKeyDown={event => {
            if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
            event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); showMenu(entry.path, entry.name, rect.left, rect.bottom, entry.directory);
          }}><span className="output-search-heading"><span className="output-tree-name">{entry.name}</span><FileTimestamp mtime={entry.mtime} /></span><small>{entry.path}</small></button>
      </div>)}
    </div> : error ? <p role="alert">{error}</p> : null}
    {fileMenu && <ActionMenu x={fileMenu.x} y={fileMenu.y} title={fileMenu.name}
      items={[{ key: "copy-path", label: "Copy full path" }, ...(!fileMenu.directory ? [
        { key: "download", label: "Download" }, ...(root === "work" && /^uploads\/[^/]+$/.test(fileMenu.path) ? [{ key: "delete", label: "Delete", danger: true }] : [])] : [])]}
      onClose={() => setFileMenu(null)} onPick={action => {
        if (action === "copy-path") void copyPath(fileMenu.path);
        if (action === "download") {
          const link = document.createElement("a");
          link.href = outputUrl(root, fileMenu.path, true);
          link.download = fileMenu.name;
          document.body.append(link);
          link.click();
          link.remove();
        }
        if (action === "delete" && root === "work" && /^uploads\/[^/]+$/.test(fileMenu.path)) {
          setDeleteError(""); setDeleteFile({ path: fileMenu.path, name: fileMenu.name });
        }
        setFileMenu(null);
      }} />}
    {deleteFile && <ConfirmDialog title="Delete uploaded file?" confirmLabel="Delete" busy={deleting}
      message={`Delete ${deleteFile.name} from ~/work/uploads? This cannot be undone.${deleteError ? ` ${deleteError}` : ""}`}
      onCancel={() => { if (!deleting) setDeleteFile(null); }} onConfirm={() => { void removeUpload(); }} />}
  </section>}</FileUploadControl>;
}
