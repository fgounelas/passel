import { useEffect, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import { Upload } from "lucide-react";
import { outputJson } from "./projectFiles";

export const MAX_DANUS_UPLOAD = 100_000_000;
export const DANUS_UPLOAD_EXTENSIONS: readonly string[] = [".pdf", ".tex", ".md", ".txt", ".djvu", ".bib", ".lean", ".csv", ".json", ".png", ".jpg", ".jpeg", ".py", ".sage", ".ipynb", ".sty", ".cls"];
export function uploadFileError(file: Pick<File, "name" | "size">): string | null {
  if (!DANUS_UPLOAD_EXTENSIONS.includes(file.name.slice(file.name.lastIndexOf(".")).toLowerCase())) return `Supported files: ${DANUS_UPLOAD_EXTENSIONS.join(", ")}.`;
  if (!file.size || file.size > MAX_DANUS_UPLOAD) return "Each file must be between 1 byte and 100 MB.";
  return null;
}

type Controls = {
  input: ReactNode; button: ReactNode; status: ReactNode;
  dropProps: { onDragOver: (event: DragEvent<HTMLElement>) => void; onDrop: (event: DragEvent<HTMLElement>) => void };
};
export function FileUploadControl({ children, onUploaded }: {
  children: (controls: Controls) => ReactNode; onUploaded: (path: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void outputJson<{ enabled: boolean }>("upload-info", abort.signal)
      .then(info => { if (!abort.signal.aborted) setEnabled(Boolean(info.enabled)); }).catch(() => {});
    return () => { abort.abort(); request.current?.abort(); };
  }, []);
  const upload = async (files: File[]) => {
    if (request.current) return;
    setError(""); setSaved(""); setMessage("");
    if (!enabled) { setError("Uploads are unavailable on this server."); return; }
    if (!files.length) return;
    if (files.length > 20) { setError("Upload up to 20 files at a time."); return; }
    for (const file of files) {
      const invalid = uploadFileError(file);
      if (invalid) { setError(`${file.name}: ${invalid}`); return; }
    }
    const abort = new AbortController(); request.current = abort; setBusy(true);
    let completed = 0;
    try {
      for (const file of files) {
        setMessage(`Uploading ${completed + 1}/${files.length}: ${file.name} to ~/work/uploads…`);
        const response = await fetch(`/api/project-files/upload?${new URLSearchParams({ name: file.name })}`, {
          method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Herdr-Upload": "1" },
          body: file, signal: abort.signal, credentials: "same-origin",
        });
        const result = await response.json().catch(() => ({})) as { error?: string; path?: string; destination?: string };
        if (!response.ok) throw new Error(result.error || `Upload failed (${response.status}).`);
        if (!result.path || !result.destination) throw new Error("Upload response was incomplete. Refresh Files before retrying.");
        completed += 1;
        setSaved(result.destination);
        onUploaded(result.path);
      }
      setMessage(`Uploaded ${completed} ${completed === 1 ? "file" : "files"} to ~/work/uploads.`);
    } catch (failure) {
      setMessage(completed ? `${completed} files uploaded before the upload stopped.` : "");
      setError(abort.signal.aborted ? "Upload cancelled. Completed files are kept; an in-flight file may already have finished—check Files before retrying." : String((failure as Error).message));
    } finally {
      request.current = null; setBusy(false);
    }
  };
  return children({
    input: <input ref={input} type="file" hidden multiple accept={DANUS_UPLOAD_EXTENSIONS.join(",")} aria-label="Choose files to upload"
      onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void upload(files); }} />,
    button: <button type="button" aria-label="Upload files" disabled={!enabled || busy}
      title={enabled ? "Upload documents, images, code or data to ~/work/uploads (100 MB per file). You can also drop files here." : "Uploads unavailable on this server"}
      onClick={() => input.current?.click()}><Upload size={16} aria-hidden="true" /></button>,
    status: <>
      {enabled && <p className="output-upload-hint">Drop documents, images, code or data here → ~/work/uploads · 100 MB each</p>}
      {message && <p className="output-upload-status" role="status">{message}</p>}
      {error && <p className="output-upload-status" role="alert">{error}</p>}
      {busy && <button className="output-upload-cancel" type="button" onClick={() => request.current?.abort()}>Cancel upload</button>}
      {saved && !busy && <button className="output-upload-copy" type="button" title={saved}
        onClick={async () => { try { await navigator.clipboard.writeText(saved); setMessage("Uploaded path copied."); }
          catch { setError(`Copy this path: ${saved}`); } }}>Copy uploaded path</button>}
    </>,
    dropProps: {
      onDragOver: event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = enabled && !busy ? "copy" : "none"; } },
      onDrop: event => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault(); event.stopPropagation();
        void upload(Array.from(event.dataTransfer.files));
      },
    },
  });
}
