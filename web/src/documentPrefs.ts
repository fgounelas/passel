import { useSyncExternalStore } from "react";

const key = "herdr-document-preferences";
const event = "herdr-document-preferences-changed";
export type DocumentPrefs = {
  pdfFit: "width" | "page";
  rememberPosition: boolean;
  markdownMode: "preview" | "source";
  rememberFolders: boolean;
};
export function parseDocumentPrefs(raw: string | null): DocumentPrefs {
  let value: Partial<DocumentPrefs> = {};
  try { value = JSON.parse(raw ?? "{}") ?? {}; } catch { /* defaults */ }
  return {
    pdfFit: value.pdfFit === "page" ? "page" : "width",
    rememberPosition: value.rememberPosition !== false,
    markdownMode: value.markdownMode === "source" ? "source" : "preview",
    rememberFolders: value.rememberFolders !== false,
  };
}
function snapshot() {
  try { return localStorage.getItem(key); } catch { return null; }
}
function subscribe(callback: () => void) {
  window.addEventListener(event, callback);
  window.addEventListener("storage", callback);
  return () => { window.removeEventListener(event, callback); window.removeEventListener("storage", callback); };
}
export function useDocumentPrefs() {
  return parseDocumentPrefs(useSyncExternalStore(subscribe, snapshot, () => null));
}
export function updateDocumentPrefs(patch: Partial<DocumentPrefs>) {
  try { localStorage.setItem(key, JSON.stringify({ ...parseDocumentPrefs(snapshot()), ...patch })); } catch { /* private mode */ }
  window.dispatchEvent(new Event(event));
}
