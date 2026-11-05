import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { fullOutputPath, outputUrl } from "./projectFiles";

describe("output browser helpers", () => {
  it("copies literal host paths for files and directories without guessing an account", () => {
    expect(fullOutputPath('/home/example/work', 'lean/projects/My proof/main.lean')).toBe('/home/example/work/lean/projects/My proof/main.lean');
    expect(fullOutputPath('/home/example/work/', 'Example')).toBe('/home/example/work/Example');
    expect(fullOutputPath('/home/example/work', 'pharos/runtime/projects/p')).toBe('/home/example/work/pharos/runtime/projects/p');
    for (const [base, path] of [[undefined, 'Example'], ['~/work', 'Example'], ['/home/example/work', '../secret'],
      ['/home/example/work', '/etc/passwd'], ['/home/example/work', 'Example/\nfile']]) {
      expect(() => fullOutputPath(base, path!)).toThrow();
    }
  });
  it("encodes paths without turning filenames into query parameters", () => {
    const url = new URL(outputUrl("danus", "p/papers/a&download=0.pdf", true), "https://example.test");
    expect(url.searchParams.get("path")).toBe("p/papers/a&download=0.pdf");
    expect(url.searchParams.get("download")).toBe("1");
  });
  it("renders Markdown math without executing raw HTML or trusted TeX commands", () => {
    const html = renderToStaticMarkup(React.createElement(ReactMarkdown, {
      skipHtml:true, remarkPlugins:[remarkMath], rehypePlugins:[[rehypeKatex, {trust:false,maxExpand:200}]],
      children: '# Title\n<script>alert(1)</script>\n\n$x^2$\n\n$\\href{javascript:alert(1)}{bad}$',
    }));
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('katex');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('href="javascript:');
  });
});
