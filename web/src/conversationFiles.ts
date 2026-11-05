import type { Root, RootContent, Element } from "hast";
import { outputJson, type OutputEntry } from "./projectFiles";

export function localFilePath(value: string): string | null {
  let path: string;
  try { path = decodeURIComponent(value).replace(/(?:#L?\d+(?:-L?\d+)?|:\d+(?::\d+)?)$/, ""); } catch { return null; }
  path = path.replace(/^file:\/\//, "").replace(/^(?:~|\/home\/[^/]+)\/work\//, "").replace(/^\.\//, "");
  if (path.length > 2000 || !/\.(md|tex|pdf)$/i.test(path) || /[\s\\?#]/.test(path) || [...path].some(c => c.charCodeAt(0) < 32) ||
    path.split("/").some(part => !part || part.startsWith("."))) return null;
  return /^(?:runtime\/projects\/|[^/:]+\/)/.test(path) ? path : null;
}

// Transform only rendered prose/inline code. Never turn code blocks, math or
// existing link labels into nested links. Limit markup per bounded message.
export function conversationFiles() {
  return (tree: Root) => {
    let remaining = 100;
    const pattern = /(?:file:\/\/)?(?:~\/work\/|\/home\/[^/\s]+\/work\/)[\w.-]+\/(?:[\w./-]|(?<=[/-])\n[ \t]*)+?\.(?:md|tex|pdf)(?:#L?\d+(?:-L?\d+)?|:\d+(?::\d+)?)?(?![\w])|(?:file:\/\/)?(?:~\/work\/|\/home\/[^/\s]+\/work\/|\.\/)?(?:[\w.-]+\/)?runtime\/projects\/(?:[\w./-]|(?<=[/-])\n[ \t]*)+?\.(?:md|tex|pdf)(?:#L?\d+(?:-L?\d+)?|:\d+(?::\d+)?)?(?![\w])|(?:~\/work\/)?uploads\/[\w.-]+\.(?:md|tex|pdf)(?![\w])/gi;
    function visit(parent: Root | Element) {
      if (parent.type === "element" && (["a", "pre"].includes(parent.tagName) || String(parent.properties.className ?? "").includes("katex"))) return;
      parent.children = (parent.children as RootContent[]).flatMap<RootContent>(child => {
        if (child.type === "element") { visit(child); return [child]; }
        if (child.type !== "text" || !remaining) return [child];
        const pieces: RootContent[] = []; let start = 0;
        for (const match of child.value.matchAll(pattern)) {
          if (!remaining) break;
          const index = match.index!;
          if (index > 0 && /[\w/:.-]/.test(child.value[index - 1])) continue;
          const path = localFilePath(match[0].replace(/\n[ \t]*/g, ""));
          if (!path) continue;
          pieces.push({ type: "text", value: child.value.slice(start, index) },
            { type: "element", tagName: "a", properties: { href: path }, children: [{type: "text", value: match[0]}] });
          start = index + match[0].length; remaining--;
        }
        if (!pieces.length) return [child];
        pieces.push({type: "text", value: child.value.slice(start)}); return pieces;
      }) as typeof parent.children;
    }
    visit(tree);
  };
}

export async function resolveConversationFile(reference: string, signal: AbortSignal): Promise<string[]> {
  const path = localFilePath(reference);
  if (!path) throw new Error("Unsupported file reference.");
  const list = (folder: string) => outputJson<{entries: OutputEntry[]}>(`list?${new URLSearchParams({root: "work", path: folder})}`, signal);
  const candidates = path.startsWith("runtime/projects/") ?
    (await list("")).entries.filter(e => e.directory && e.name !== "uploads").slice(0, 32).map(e => `${e.name}/${path}`) : [path];
  const found: string[] = [];
  // Click-only, bounded directory lookups; no recursive search or file downloads.
  for (const candidate of candidates) {
    const slash = candidate.lastIndexOf("/");
    try {
      const result = await list(candidate.slice(0, slash));
      if (result.entries.some(e => !e.directory && e.name === candidate.slice(slash + 1))) found.push(candidate);
    } catch (error) { if (signal.aborted || candidates.length === 1) throw error; }
  }
  if (!found.length) throw new Error("File not found or not available in Files.");
  return found;
}
