import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeMarkdownMath } from "./markdownMath";

it("renders the inline and display delimiters used by Danus facts", () => {
  const source = String.raw`For some \(a\in k\), the equation is
\[
z^2+zx^5s^2+x^3y^7s^4+a x^8s^3t+xyt^4=0.
\]
Existing $x^2$ math still works.`;
  const html = renderToStaticMarkup(createElement(ReactMarkdown, {
    children: normalizeMarkdownMath(source), remarkPlugins: [remarkMath],
    rehypePlugins: [[rehypeKatex, {trust: false, maxExpand: 200}]],
  }));
  expect(html.match(/class="katex"/g)).toHaveLength(3);
  expect(html).toContain('katex-display');
  expect(html).not.toContain('katex-error');
});

it("preserves code, existing dollar math, link URLs, escaped and unmatched delimiters", () => {
  const samples = [
    '`\\(x\\)`',
    '```tex\n\\[x\\]\n```',
    '~~~\n\\(x\\)\n~~~',
    '    \\(x\\)\n',
    String.raw`$\text{\( literal \)}$`,
    String.raw`[example](https://example.test/\(x\))`,
    String.raw`\\(literal\\)`,
    String.raw`unmatched \(x`,
  ];
  for (const source of samples) expect(normalizeMarkdownMath(source)).toBe(source);
  const mixed = '`\\(code\\)` then \\(x^2\\)';
  expect(normalizeMarkdownMath(mixed)).toBe('`\\(code\\)` then $x^2$');
});
