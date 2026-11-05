// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { OutputFileTree } from "./OutputFileTree";

it("loads only expanded branches, preserves expansion, and reveals a nested file", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); sessionStorage.clear(); localStorage.clear();
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = new URL(url, 'https://test').searchParams.get('path') ?? '';
    requests.push(path);
    const names = path === '' ? ['project', 'unopened'] : path === 'project' ? ['papers', 'facts'] : ['main.md'];
    return new Response(JSON.stringify({entries: names.map(name => ({name, directory: !name.endsWith('.md'), size: 10, mtime: 1}))}));
  }));
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const preview = vi.fn();
  const render = (collapse = 0, reveal: {path: string; token: number} | null = null) => root.render(
    <OutputFileTree root="danus" collapse={collapse} reveal={reveal} onMenu={vi.fn()} onPreview={preview} />);
  const row = (path: string) => [...container.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')].find(el => el.dataset.path === path)!;
  try {
    await act(async () => render());
    expect(requests).toEqual(['']);
    await act(async () => row('project').click());
    await act(async () => row('project/papers').click());
    expect(requests).toEqual(['', 'project', 'project/papers']);
    await act(async () => row('project/papers/main.md').click());
    expect(preview).toHaveBeenCalledWith('project/papers/main.md');
    await act(async () => row('project').click());
    expect(row('project/papers')).toBeUndefined();
    await act(async () => row('project').click());
    expect(row('project/papers/main.md')).toBeTruthy();
    expect(requests).toHaveLength(3);
    expect(JSON.parse(sessionStorage.getItem('herdr-files-expanded:danus')!)).toContain('project/papers');
    expect(JSON.parse(localStorage.getItem('herdr-files-expanded:danus')!)).toContain('project/papers');
    await act(async () => render(1));
    expect(row('project/papers')).toBeUndefined();
    await act(async () => render(1, {path: 'project/facts/main.md', token: 1}));
    expect(document.activeElement).toBe(row('project/facts/main.md'));
    expect(requests).toContain('project/facts');
    expect(requests).not.toContain('unopened');
    await act(async () => row('project/facts/main.md').dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowLeft', bubbles: true})));
    expect(document.activeElement).toBe(row('project/facts'));
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
  }
});

it("refreshes expanded folders without losing expansion or focused rows", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); sessionStorage.clear(); localStorage.clear();
  let updated = false;
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = new URL(url, "https://test").searchParams.get("path") ?? "";
    requests.push(path);
    const names = path === "" ? ["project", "closed"] : updated ? ["old.md", "new.md"] : ["old.md"];
    return new Response(JSON.stringify({ entries: names.map(name => ({ name, directory: !name.endsWith(".md"), size: 1, mtime: 1 })) }));
  }));
  const element = document.createElement("div"); document.body.append(element); const root = createRoot(element);
  const render = (revision: number, active = true) => root.render(<OutputFileTree root="danus" collapse={0} reveal={null} revision={revision} active={active} onPreview={vi.fn()} onMenu={vi.fn()} />);
  try {
    await act(async () => render(0));
    const project = element.querySelector<HTMLButtonElement>('[data-path="project"]')!;
    await act(async () => { project.click(); project.focus(); });
    updated = true;
    await act(async () => render(1));
    expect(element.querySelector('[data-path="project/new.md"]')).toBeTruthy();
    expect(document.activeElement).toBe(project);
    expect(project.getAttribute("aria-expanded")).toBe("true");
    expect(requests).not.toContain("closed");
    const count = requests.length;
    await act(async () => render(2, false));
    expect(requests).toHaveLength(count);
  } finally { await act(async () => root.unmount()); element.remove(); vi.unstubAllGlobals(); }
});

it("expands and focuses a revealed project folder without opening a document", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = new URL(url, "https://test").searchParams.get("path") ?? "";
    const names = path === "" ? ["project"] : ["papers"];
    return new Response(JSON.stringify({entries: names.map(name => ({name, directory: true}))}));
  }));
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); const preview = vi.fn();
  try {
    await act(async () => root.render(<OutputFileTree root="work" collapse={0} reveal={{path: "project", directory: true, token: 1}} onPreview={preview} onMenu={vi.fn()} />));
    const project = host.querySelector('[data-path="project"]');
    expect(project?.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(project);
    expect(host.querySelector('[data-path="project/papers"]')).not.toBeNull();
    expect(preview).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
