import { afterEach, expect, it, vi } from "vitest";
import { projectFolders, referencedProjects } from "./ProjectFolderButton";

afterEach(() => vi.unstubAllGlobals());
function mockFiles(text: string) {
  const fetcher = vi.fn(async (url: string) => {
    const parsed = new URL(url, "https://test");
    if (parsed.pathname.endsWith("/conversation")) return new Response(JSON.stringify({status: "ok", messages: [{text}]}));
    const path = parsed.searchParams.get("path");
    const names = path === "" ? ["danus", "danus-mine", "uploads"] : ["example", "other"];
    return new Response(JSON.stringify({entries: names.map(name => ({name, directory: true}))}));
  });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}

it("uses an exact project cwd without reading another conversation", async () => {
  const fetcher = mockFiles("runtime/projects/other/plans/plan.md");
  expect(await projectFolders("pane", "/home/example/work/danus/runtime/projects/example/workers/xhigh", new AbortController().signal))
    .toEqual(["danus/runtime/projects/example"]);
  expect(fetcher.mock.calls.some(([url]) => url.includes("conversation"))).toBe(false);
});

it("opens an ordinary workspace cwd directly rather than looking for runtime/projects", async () => {
  const fetcher = vi.fn(async (url: string) => {
    const path = new URL(url, "https://test").searchParams.get("path");
    if (url.includes("conversation?") || path?.includes("runtime/projects")) throw new Error("Unnecessary lookup");
    return new Response(JSON.stringify({ entries: path === "" ? [{ name: "Example", directory: true }, { name: "danus", directory: true }] : [] }));
  });
  vi.stubGlobal("fetch", fetcher);
  expect(await projectFolders("pane", "/home/example/work/Example", new AbortController().signal)).toEqual(["Example"]);
  expect(await projectFolders("pane", "/home/example/work/Example/drafts", new AbortController().signal)).toEqual(["Example/drafts"]);
  expect(fetcher.mock.calls.some(([url]) => url.includes("conversation?"))).toBe(false);
});

it("finds Pharos projects from its configured workspace and conversation references", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = new URL(url, "https://test").searchParams.get("path");
    return new Response(JSON.stringify(url.includes("/conversation?")
      ? { status: "ok", messages: [{ text: "Saved runtime/projects/sample-project/worker_report/xhigh/report.md" }] }
      : { entries: (path === "" ? ["danus", "pharos", "uploads"] : ["sample-project", "other"]).map(name => ({ name, directory: true })) }));
  }));
  expect(await projectFolders("pane", "/home/example/work/pharos", new AbortController().signal))
    .toEqual(["pharos/runtime/projects/sample-project"]);
});

it("opens the sole Pharos project without depending on conversation availability", async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes("conversation?")) throw new Error("Conversation unavailable");
    const path = new URL(url, "https://test").searchParams.get("path");
    return new Response(JSON.stringify({ entries: (path === "" ? ["danus", "pharos", "uploads"] : ["sample-project"])
      .map(name => ({ name, directory: true })) }));
  });
  vi.stubGlobal("fetch", fetcher);
  expect(await projectFolders("w7:p5", "/home/example/work/pharos", new AbortController().signal))
    .toEqual(["pharos/runtime/projects/sample-project"]);
  expect(fetcher.mock.calls.some(([url]) => url.includes("conversation?"))).toBe(false);
});

it("offers validated project choices if the conversation request fails", async () => {
  const fetcher = mockFiles("");
  const implementation = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async url => url.includes("conversation?")
    ? new Response("Temporarily unavailable", { status: 502 }) : implementation(url));
  expect(await projectFolders("pane", "/home/example/work/danus", new AbortController().signal))
    .toEqual(["danus/runtime/projects/example", "danus/runtime/projects/other"]);
});

it("does not turn a cancelled conversation lookup into stale folder choices", async () => {
  const controller = new AbortController();
  const fetcher = mockFiles("");
  const implementation = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async url => {
    if (!url.includes("conversation?")) return implementation(url);
    controller.abort(); throw new DOMException("Aborted", "AbortError");
  });
  await expect(projectFolders("pane", "/home/example/work/danus", controller.signal)).rejects.toThrow("Aborted");
});

it("resolves references within the pane's account runtime", async () => {
  mockFiles("Saved in runtime/projects/example/papers/main.pdf.");
  expect(await projectFolders("pane", "/home/example/work/danus-mine", new AbortController().signal))
    .toEqual(["danus-mine/runtime/projects/example"]);
});

it("offers choices when context is ambiguous or absent instead of guessing", async () => {
  mockFiles("Compare runtime/projects/example and runtime/projects/other.");
  expect(await projectFolders("pane", "/home/example/work/danus", new AbortController().signal))
    .toEqual(["danus/runtime/projects/example", "danus/runtime/projects/other"]);
  // A full folder reference with trailing prose punctuation is not used to
  // invent a path; candidates must exist in the allow-listed directory listing.
  expect(referencedProjects("runtime/projects/example/papers/main.pdf")).toEqual(new Set(["example"]));
  mockFiles("No project reference.");
  expect(await projectFolders("pane", "/home/example/work/danus", new AbortController().signal))
    .toEqual(["danus/runtime/projects/example", "danus/runtime/projects/other"]);
});

it("reuses a remembered choice only while it is an available folder in this runtime", async () => {
  const fetcher = mockFiles("runtime/projects/other/plans/main.md");
  expect(await projectFolders("pane", "/home/example/work/danus", new AbortController().signal,
    {preferred: "danus/runtime/projects/example"})).toEqual(["danus/runtime/projects/example"]);
  expect(fetcher.mock.calls.some(([url]) => url.includes("conversation"))).toBe(false);
  expect(await projectFolders("pane", "/home/example/work/danus", new AbortController().signal,
    {preferred: "danus/runtime/projects/deleted"})).toEqual(["danus/runtime/projects/other"]);
  expect(await projectFolders("pane", "/home/example/work/danus", new AbortController().signal,
    {preferred: "danus-mine/runtime/projects/example"})).toEqual(["danus/runtime/projects/other"]);
});

it("lets an explicit project cwd take precedence and lets the reader choose another folder", async () => {
  mockFiles("runtime/projects/example/plans/main.md");
  expect(await projectFolders("pane", "/home/example/work/danus/runtime/projects/other", new AbortController().signal,
    {preferred: "danus/runtime/projects/example"})).toEqual(["danus/runtime/projects/other"]);
  expect(await projectFolders("pane", "/home/example/work/danus", new AbortController().signal,
    {preferred: "danus/runtime/projects/example", choose: true})).toEqual(["danus/runtime/projects/example", "danus/runtime/projects/other"]);
});
