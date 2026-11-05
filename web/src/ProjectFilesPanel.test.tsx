/** @vitest-environment jsdom */
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import ProjectFilesPanel, { OutputViewerPanel } from "./ProjectFilesPanel";
import type { OutputSelection } from "./ProjectFilesPanel";

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });
it.each([false, true])("shows complete TeX source with matching PDF available: %s", async matching => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const source = String.raw`\documentclass{article}
\newcommand{\Om}{\Omega}
\begin{document}
Here is the full argument, including $\Om^1_X$.
\[x^2+y^2=z^2\]
<script>alert(1)</script>
\end{document}`;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(url.includes("/list?")
    ? JSON.stringify({ entries: matching ? [{ name: "main.pdf", directory: false }] : [] }) : source)));
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); const onSelect = vi.fn();
  try {
    await act(async () => root.render(<OutputViewerPanel file={{ root: "work", path: "uploads/main.tex", version: 0 }}
      onSelect={onSelect} onClose={vi.fn()} width={480} onWidth={vi.fn()} />));
    expect(container.querySelector(".output-reading-content > pre")?.textContent).toBe(source);
    const reader = container.querySelector<HTMLDivElement>('[aria-label="Document contents"]')!;
    expect(document.activeElement).toBe(reader);
    const selectAll = new KeyboardEvent("keydown", {key: "a", metaKey: true, bubbles: true, cancelable: true});
    reader.dispatchEvent(selectAll);
    expect(selectAll.defaultPrevented).toBe(true);
    expect(window.getSelection()?.toString()).toBe(source);
    expect(container.querySelector("script, .katex")).toBeNull();
    const buttons = [...container.querySelectorAll<HTMLButtonElement>(".output-preview button")];
    expect(buttons.map(button => button.textContent)).toEqual(matching ? ["View matching PDF"] : []);
    if (matching) {
      await act(async () => buttons[0].click());
      expect(onSelect).toHaveBeenCalledWith({ root: "work", path: "uploads/main.pdf", version: 0 });
    }
  } finally { await act(async () => root.unmount()); }
});

it("browses only GET endpoints, renders Markdown, downloads and collapses without terminal commands", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionStorage.clear(); localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    requests.push(url);
    if (url.includes('/roots')) return new Response(JSON.stringify({roots:['danus']}));
    if (url.includes('/content')) return new Response('# A paper\n\n$H^1(X)$ and \\(a\\in k\\)\n\n\\[x^2+y^2=z^2\\]');
    const path = new URL(url, 'https://example.test').searchParams.get('path');
    const name = path === '' ? 'project' : path === 'project' ? 'papers' : 'main.md';
    return new Response(JSON.stringify({entries:[{name,directory:name!=='main.md',size:100,mtime:1}]}));
  }));
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); const onClose = vi.fn();
  function Harness() {
    const [file, setFile] = useState<OutputSelection | null>(null);
    const [open, setOpen] = useState(false);
    return <>
      <ProjectFilesPanel selected={file} onPreview={next => { setFile(next); setOpen(true); }} />
      {file && !open && <button onClick={() => setOpen(true)}>Open document viewer</button>}
      {file && open && <OutputViewerPanel file={file} onSelect={setFile} width={480} onWidth={vi.fn()}
        onClose={() => { onClose(); setOpen(false); }} />}
    </>;
  }
  const tick = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
  const click = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find(b => b.textContent?.includes(label));
    expect(button).toBeTruthy();
    await act(async () => { button!.click(); await tick(); });
  };
  try {
    await act(async () => { root.render(<Harness />); await tick(); });
    expect(container.querySelector('[aria-label="Project root"]')).toBeNull();
    expect(container.querySelector('[aria-label="File browser root"]')?.textContent).toBe('~/work');
    await click('project'); await click('papers');
    const fileButton = container.querySelector('[data-path="project/papers/main.md"]') as HTMLButtonElement;
    await act(async () => fileButton.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, clientX: 50, clientY: 100})));
    expect(container.querySelector('[role="menu"]')).toBeTruthy();
    expect(container.querySelector('[role="menu"]')?.textContent).not.toContain('Delete');
    expect(requests.some(url => url.includes('/content'))).toBe(false);
    const downloads: string[] = [];
    const downloadClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.href);
    });
    try {
      await click('Download');
      expect(downloads).toHaveLength(1);
      const download = new URL(downloads[0]);
      expect(download.searchParams.get('path')).toBe('project/papers/main.md');
      expect(download.searchParams.get('root')).toBe('danus');
      expect(download.searchParams.get('download')).toBe('1');
      expect(container.querySelector('[role="menu"]')).toBeNull();
      expect(requests.some(url => url.includes('/content'))).toBe(false);
    } finally { downloadClick.mockRestore(); }
    await act(async () => fileButton.dispatchEvent(new KeyboardEvent('keydown', {key: 'F10', shiftKey: true, bubbles: true})));
    expect(container.querySelector('[role="menu"]')).toBeTruthy();
    await act(async () => {
      container.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    });
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await click('main.md');
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(container.querySelector('h1')?.textContent).toBe('A paper');
    expect(container.querySelectorAll('.katex')).toHaveLength(3);
    expect(container.querySelector('.katex-display')).toBeTruthy();
    const reader = container.querySelector<HTMLDivElement>('[aria-label="Document contents"]')!;
    reader.dispatchEvent(new KeyboardEvent('keydown', {key: 'a', ctrlKey: true, bubbles: true, cancelable: true}));
    expect(window.getSelection()?.toString()).toBe(container.querySelector('.output-reading-content')?.textContent);
    expect(window.getSelection()?.toString()).not.toContain('~/work');
    await click('Source');
    expect(container.querySelector('.output-document pre')?.textContent).toContain('\\(a\\in k\\)');
    await click('Rendered');
    expect(container.querySelector('a[download]')?.getAttribute('href')).toContain('download=1');
    expect(requests.every(url => url.startsWith('/api/project-files/'))).toBe(true);
    await act(async () => { (container.querySelector('[aria-label="Collapse document viewer"]') as HTMLButtonElement).click(); });
    expect(onClose).toHaveBeenCalledOnce();
    expect(container.querySelector('[aria-label="Files"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="File preview"]')).toBeNull();
    await click('Open document viewer');
    expect(container.querySelector('h1')?.textContent).toBe('A paper');
  } finally { await act(async () => root.unmount()); }
});

it("searches filenames beyond unopened folders and previews the returned full path", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); sessionStorage.clear();
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", {clipboard:{writeText}});
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    requests.push(url);
    if (url.includes('/roots')) return new Response(JSON.stringify({roots: ['work'],paths:{work:'/home/example/work'}}));
    if (url.includes('/search')) return new Response(JSON.stringify({entries: [{name: 'lemma.md', path: 'danus-mine/runtime/projects/other/fact_graph/facts/lemma.md', directory: false, size: 10, mtime: 1}], truncated: true}));
    return new Response(JSON.stringify({entries: [{name: 'other', directory: true, size: 0, mtime: 1}]}));
  }));
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); const onPreview = vi.fn();
  try {
    await act(async () => root.render(<ProjectFilesPanel selected={null} onPreview={onPreview} />));
    const input = container.querySelector('[aria-label="Search filenames"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'lemma');
      input.dispatchEvent(new Event('input', {bubbles: true}));
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
    expect(requests.some(url => url.includes('/search?root=work&q=lemma'))).toBe(true);
    expect(requests.filter(url => url.includes('/list'))).toHaveLength(1);
    expect(container.textContent).toContain('Results limited');
    const result = container.querySelector('.output-search-result') as HTMLButtonElement;
    await act(async () => result.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true})));
    const copy = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(b=>b.textContent==='Copy full path')!;
    await act(async()=>copy.click());
    expect(writeText).toHaveBeenCalledWith('/home/example/work/danus-mine/runtime/projects/other/fact_graph/facts/lemma.md');
    expect(onPreview).not.toHaveBeenCalled();
    await act(async () => result.click());
    expect(onPreview).toHaveBeenCalledWith({root: 'work', path: 'danus-mine/runtime/projects/other/fact_graph/facts/lemma.md', version: 0});
  } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); }
});

it("polls visible Files and stops polling when the panel is hidden", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); sessionStorage.clear(); localStorage.clear();
  const hidden = Object.getOwnPropertyDescriptor(document, "hidden");
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    requests.push(url);
    return new Response(JSON.stringify(url.endsWith("roots") ? { roots: ["work"] } : url.endsWith("upload-info") ? { enabled: false } : { entries: [] }));
  }));
  const element = document.createElement("div"); document.body.append(element); const root = createRoot(element);
  try {
    await act(async () => root.render(<ProjectFilesPanel active selected={null} onPreview={vi.fn()} />));
    vi.useFakeTimers();
    // Rerender the effect so its interval uses the fake clock.
    await act(async () => root.render(<ProjectFilesPanel active={false} selected={null} onPreview={vi.fn()} />));
    await act(async () => root.render(<ProjectFilesPanel active selected={null} onPreview={vi.fn()} />));
    const count = requests.filter(url => url.includes("/list?")).length;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(requests.filter(url => url.includes("/list?"))).toHaveLength(count + 1);
    await act(async () => root.render(<ProjectFilesPanel active={false} selected={null} onPreview={vi.fn()} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(requests.filter(url => url.includes("/list?"))).toHaveLength(count + 1);
  } finally {
    await act(async () => root.unmount()); element.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
    if (hidden) Object.defineProperty(document, "hidden", hidden); else Reflect.deleteProperty(document, "hidden");
  }
});

it("confirms deletion only for upload files and refreshes after success", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); sessionStorage.clear(); localStorage.clear();
  let deleted = false; const mutations: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit = {}) => {
    if (options.method === "DELETE") { mutations.push(url); deleted = true; return new Response(JSON.stringify({ deleted: "uploads/paper.pdf" })); }
    if (url.endsWith("roots")) return new Response(JSON.stringify({ roots: ["work"] }));
    if (url.endsWith("upload-info")) return new Response(JSON.stringify({ enabled: true }));
    const path = new URL(url, "https://test").searchParams.get("path");
    return new Response(JSON.stringify({ entries: path === "" ? [{ name: "uploads", directory: true }] : deleted ? [] : [{ name: "paper.pdf", directory: false }] }));
  }));
  const element = document.createElement("div"); document.body.append(element); const root = createRoot(element); const onDeleted = vi.fn();
  const click = async (label: string) => { await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find(b => (b.querySelector('.output-tree-name')?.textContent ?? b.textContent) === label)!.click()); };
  const menu = async () => { await act(async () => element.querySelector('[data-path="uploads/paper.pdf"]')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))); };
  try {
    await act(async () => root.render(<ProjectFilesPanel selected={null} onPreview={vi.fn()} onDeleted={onDeleted} />));
    await act(async () => (element.querySelector('[data-path="uploads"]') as HTMLButtonElement).click());
    await menu(); await click("Delete");
    expect(element.querySelector('[role="dialog"]')?.textContent).toContain("~/work/uploads");
    expect(mutations).toHaveLength(0);
    await click("Cancel"); expect(mutations).toHaveLength(0);
    await menu(); await click("Delete"); await click("Delete");
    expect(mutations).toEqual(["/api/project-files/upload?name=paper.pdf"]);
    expect(onDeleted).toHaveBeenCalledWith("uploads/paper.pdf");
    expect(element.querySelector('[data-path="uploads/paper.pdf"]')).toBeNull();
  } finally { await act(async () => root.unmount()); element.remove(); }
});

it("renders facts with collapsed metadata, literal notation and unchanged Source", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  localStorage.clear();
  const source = '---\nfact_id: example\nauthor: high\n---\n\n## statement\nnu^* omega_W = omega_{W^nu}(Delta).\nDisc(W/X)=B_q+q_*Delta.\n\n## proof\nThe proof remains complete.';
  vi.stubGlobal("fetch", vi.fn(async () => new Response(source)));
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<OutputViewerPanel file={{root: 'danus', path: 'project/fact_graph/facts/example.md', version: 0}}
      onClose={() => {}} onSelect={() => {}} width={600} onWidth={() => {}} />));
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toBe('Fact details');
    expect(details.querySelector('pre')?.textContent).toContain('fact_id: example');
    expect(container.querySelector('h2')?.textContent).toBe('statement');
    expect(container.querySelector('.output-fact > p')?.textContent).toContain('nu^* omega_W = omega_{W^nu}(Delta).\nDisc(W/X)=B_q+q_*Delta.');
    expect(container.querySelector('.output-fact em')).toBeNull();
    await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === 'Source')!.click(); });
    expect(container.querySelector('.output-reading-content > pre')?.textContent).toBe(source);
    expect(container.querySelector('details')).toBeNull();
  } finally { await act(async () => root.unmount()); }
});

it("reveals a conversation file by expanding and focusing its tree path without opening the viewer", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); sessionStorage.clear(); localStorage.clear();
  const target = "danus/runtime/projects/p/plans/audit.md";
  const parts = target.split("/");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/roots")) return new Response(JSON.stringify({roots: ["work"]}));
    const path = new URL(url, "https://test").searchParams.get("path") ?? "";
    const index = path ? path.split("/").length : 0;
    return new Response(JSON.stringify({entries: [{name: parts[index], directory: index < parts.length - 1}]}));
  }));
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); const preview = vi.fn();
  try {
    await act(async () => root.render(<ProjectFilesPanel selected={null} onPreview={preview} externalReveal={{path: target, token: 1}} />));
    const row = host.querySelector(`[data-path="${target}"]`);
    expect(row).toBeTruthy(); expect(document.activeElement).toBe(row);
    expect(row?.getAttribute("aria-selected")).toBe("true"); expect(preview).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("displays Lean code literally without interpreting Markdown or HTML", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const source = '/- # Heading *literal* <script>alert(1)</script> -/\ntheorem example : 1 = 1 := rfl';
  vi.stubGlobal("fetch", vi.fn(async () => new Response(source)));
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<OutputViewerPanel file={{root: 'work', path: 'lean/projects/demo/Main.lean', version: 0}}
        onSelect={vi.fn()} onClose={vi.fn()} width={480} onWidth={vi.fn()} />);
    });
    expect(container.querySelector('pre')?.textContent).toBe(source);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('.output-preview button')).toBeNull();
  } finally { await act(async () => root.unmount()); }
});

it.each(["bib", "lean", "csv", "json", "py", "sage", "ipynb", "sty", "cls"])("shows uploaded %s as literal source", async extension => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const source = '# Literal source\n$x^2$ <script>alert(1)</script>';
  vi.stubGlobal("fetch", vi.fn(async () => new Response(source)));
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<OutputViewerPanel file={{ root: "work", path: `uploads/example.${extension}`, version: 0 }}
      onSelect={vi.fn()} onClose={vi.fn()} width={480} onWidth={vi.fn()} />));
    expect(host.querySelector("pre")?.textContent).toBe(source);
    expect(host.querySelector("script, .katex, h1")).toBeNull();
    expect(host.querySelector(".output-preview button")).toBeNull();
  } finally { await act(async () => root.unmount()); }
});

it.each(["png", "jpg", "jpeg"])("offers uploaded %s as download-only without fetching or decoding an image", async extension => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<OutputViewerPanel file={{ root: "work", path: `uploads/figure.${extension}`, version: 0 }}
      onSelect={vi.fn()} onClose={vi.fn()} width={480} onWidth={vi.fn()} />));
    expect(fetcher).not.toHaveBeenCalled();
    expect(host.querySelector("img, pre")).toBeNull();
    expect(host.textContent).toContain("Image preview is unavailable. Use Download");
    expect(host.querySelector("a[download]")?.getAttribute("href")).toContain("download=1");
  } finally { await act(async () => root.unmount()); }
});

it("keeps ordinary workspace binary files download-only", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  const host=document.createElement("div");const root=createRoot(host);
  try {
    await act(async () => root.render(<OutputViewerPanel file={{root:"work",path:"Example/artifact.bin",version:0}}
      onSelect={vi.fn()} onClose={vi.fn()} width={480} onWidth={vi.fn()} />));
    expect(fetcher).not.toHaveBeenCalled();
    expect(host.textContent).toContain("File preview is unavailable. Use Download");
  } finally { await act(async () => root.unmount()); }
});

it("copies real file and folder paths from menus, leaves folders read-only, and reports clipboard failure", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); sessionStorage.clear();
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", {clipboard: {writeText}});
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes('/roots')) return new Response(JSON.stringify({roots:['work'],paths:{work:'/home/example/work'}}));
    if (url.includes('/upload-info')) return new Response(JSON.stringify({enabled:false}));
    const path = new URL(url,'https://example.test').searchParams.get('path');
    return new Response(JSON.stringify({entries:path ? [{name:'my paper.md',directory:false,mtime:1,size:5}] : [{name:'Example',directory:true,mtime:1,size:0}]}));
  });
  vi.stubGlobal('fetch',fetcher);
  const host=document.createElement('div');document.body.append(host);const app=createRoot(host);const preview=vi.fn();
  const copy = () => [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(b=>b.textContent==='Copy full path')!;
  try {
    await act(async()=>app.render(<ProjectFilesPanel selected={null} onPreview={preview}/>));
    const folder=host.querySelector<HTMLButtonElement>('[data-path="Example"]')!;
    const context=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});
    await act(async()=>folder.dispatchEvent(context));
    expect(context.defaultPrevented).toBe(true);
    expect([...host.querySelectorAll('[role="menuitem"]')].map(b=>b.textContent)).toEqual(['Copy full path']);
    await act(async()=>copy().click());
    expect(writeText).toHaveBeenLastCalledWith('/home/example/work/Example');
    expect(host.textContent).toContain('Full path copied.');
    expect(folder.getAttribute('aria-expanded')).toBe('false');
    expect(preview).not.toHaveBeenCalled();
    await act(async()=>folder.click());
    const file=host.querySelector<HTMLButtonElement>('[data-path="Example/my paper.md"]')!;
    await act(async()=>file.dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true,cancelable:true})));
    expect([...host.querySelectorAll('[role="menuitem"]')].map(b=>b.textContent)).toEqual(['Copy full path','Download']);
    await act(async()=>copy().click());
    expect(writeText).toHaveBeenLastCalledWith('/home/example/work/Example/my paper.md');
    expect(fetcher.mock.calls.some(([url])=>url.includes('/content'))).toBe(false);
    writeText.mockRejectedValueOnce(new Error('Clipboard permission denied.'));
    await act(async()=>folder.dispatchEvent(new KeyboardEvent('keydown',{key:'ContextMenu',bubbles:true,cancelable:true})));
    await act(async()=>copy().click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Clipboard permission denied');
    expect(host.textContent).not.toContain('Full path copied.');
  } finally {await act(async()=>app.unmount());}
});
