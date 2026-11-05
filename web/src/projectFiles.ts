export type OutputEntry = { name: string; directory: boolean; size: number; mtime: number };
export function fullOutputPath(base: string | undefined, path: string): string {
  if (!base?.startsWith('/') || (base + path).includes('\\') || [...(base + path)].some(c => c.charCodeAt(0) < 32) ||
    base.split('/').some(part => part === '..') ||
    (path && path.split('/').some(part => !part || part.startsWith('.')))) {
    throw new Error("Full path unavailable. Refresh Files and try again.");
  }
  return base.replace(/\/+$/, '') + (path ? `/${path}` : '');
}
export function outputPreviewKind(path: string): "pdf" | "tex" | "markdown" | "text" | "download" {
  const name = path.split("/").at(-1)?.toLowerCase() ?? "";
  const extension = name.slice(name.lastIndexOf("."));
  if (extension === ".pdf") return "pdf";
  if (extension === ".tex") return "tex";
  if (extension === ".md") return "markdown";
  if ([".txt", ".lean", ".toml", ".json", ".bib", ".csv", ".py", ".sage", ".ipynb", ".sty", ".cls",
    ".yaml", ".yml", ".sh", ".rs", ".js", ".ts", ".tsx", ".jsx", ".c", ".h", ".cpp", ".hpp", ".jl", ".r",
    ".pl", ".log", ".ini", ".cfg", ".xml", ".html", ".css"].includes(extension) ||
    ["readme", "license", "makefile", "dockerfile", "lean-toolchain", "copying", "notice"].includes(name)) return "text";
  return "download";
}
export function outputUrl(root: string, path: string, download = false) {
  return `/api/project-files/content?${new URLSearchParams({ root, path, ...(download ? { download: "1" } : {}) })}`;
}
export async function outputJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/project-files/${path}`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 401 ? "Sign in again, then refresh." : "Output unavailable or not permitted.");
  return response.json() as Promise<T>;
}
