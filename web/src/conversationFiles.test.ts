import { expect, it, vi, afterEach } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { conversationFiles, localFilePath, resolveConversationFile } from "./conversationFiles";
import type { Root, Element } from "hast";
afterEach(() => vi.unstubAllGlobals());
it("links saved audits, wrapped facts, inline code and existing Markdown destinations without touching code blocks", async () => {
  const text = "Saved (runtime/projects/project/plans/exceptional-\n  lagrangian.md). Fact (runtime/projects/project/fact_graph/facts/\n  abee.md). `runtime/projects/project/paper/main.tex`\n\n[audit](runtime/projects/project/RUN-2026-09-14.md)\n\n```\nruntime/projects/project/paper/private.pdf\n```";
  const processor = unified().use(remarkParse).use(remarkRehype).use(conversationFiles);
  const tree = await processor.run(processor.parse(text)) as Root;
  const links: string[] = [];
  const visit = (node: Root | Element) => node.children.forEach(child => {
    if (child.type === "element") { if (child.tagName === "a") links.push(String(child.properties.href)); visit(child); }
  });
  visit(tree);
  expect(links).toEqual(["runtime/projects/project/plans/exceptional-lagrangian.md", "runtime/projects/project/fact_graph/facts/abee.md", "runtime/projects/project/paper/main.tex", "runtime/projects/project/RUN-2026-09-14.md"]);
});
it("validates local references and line suffixes", () => {
  expect(localFilePath("/home/example/work/danus/runtime/projects/p/paper/main.pdf#L12")).toBe("danus/runtime/projects/p/paper/main.pdf");
  expect(localFilePath("/home/example/work/pharos/runtime/projects/sample-project/worker_report/xhigh/report.md")).toBe("pharos/runtime/projects/sample-project/worker_report/xhigh/report.md");
  expect(localFilePath("/home/example/work/Example/main.tex")).toBe("Example/main.tex");
  for (const value of ["https://example.com/main.pdf", "javascript:evil", "runtime/projects/../secret.md", "runtime/projects/p/.secret.md", "runtime/projects/p/paper/a%00.md", "//other/runtime/projects/p/paper/a.md"]) expect(localFilePath(value)).toBeNull();
});
it("resolves relative paths only against listed files and reports ambiguity", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify({entries: new URL(url, "https://test").searchParams.get("path") === "" ?
    [{name: "danus", directory: true}, {name: "danus-mine", directory: true}] : [{name: "a.md", directory: false}]}))));
  expect(await resolveConversationFile("runtime/projects/p/plans/a.md", new AbortController().signal)).toEqual(["danus/runtime/projects/p/plans/a.md", "danus-mine/runtime/projects/p/plans/a.md"]);
});

it("links ordinary work-folder references and validates them with a directory lookup", async () => {
  const processor=unified().use(remarkParse).use(remarkRehype).use(conversationFiles);
  const tree=await processor.run(processor.parse("Saved /home/example/work/Example/main.tex.")) as Root;
  const paragraph=tree.children.find(node => node.type==="element") as Element;
  const link=paragraph.children.find(node => node.type==="element" && node.tagName==="a") as Element;
  expect(link.properties.href).toBe("Example/main.tex");
  vi.stubGlobal("fetch",vi.fn(async () => new Response(JSON.stringify({entries:[{name:"main.tex",directory:false}]}))));
  expect(await resolveConversationFile("Example/main.tex",new AbortController().signal)).toEqual(["Example/main.tex"]);
});
