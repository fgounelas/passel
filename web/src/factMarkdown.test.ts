import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { splitFactMarkdown, remarkFactNotation } from "./factMarkdown";
import { normalizeMarkdownMath } from "./markdownMath";

it("recognizes fact frontmatter without changing the body or unrelated Markdown", () => {
  const source = '---\nfact_id: example\nauthor: high\npredecessors: []\n---\n\n## statement\nq_*Delta = nu^*omega_W.\n';
  expect(splitFactMarkdown('project/fact_graph/facts/example.md', source)).toEqual({
    metadata: 'fact_id: example\nauthor: high\npredecessors: []', body: '\n## statement\nq_*Delta = nu^*omega_W.\n',
  });
  expect(splitFactMarkdown('project/notes/example.md', source)).toBeNull();
  expect(splitFactMarkdown('project/facts/example.md', '---\nA heading\n---\n')).toBeNull();
  expect(splitFactMarkdown('project/facts/example.md', '---\nfact_id: example\nUnclosed')).toBeNull();
});

it("keeps plain mathematical stars/underscores and equation line breaks while rendering explicit LaTeX", () => {
  const body = String.raw`## statement
O_{X x P^1}(W)=p_X^*O_X(kH) tensor p_1^*O_{P^1}(e).
nu^* omega_W = omega_{W^nu}(Delta).
Disc(W/X)=B_q+q_*Delta.

## proof
Explicit \(x^2+y^2\) still renders.

- A list item with q_*R_q.
`;
  const html = renderToStaticMarkup(createElement(ReactMarkdown, {children: normalizeMarkdownMath(body),
    remarkPlugins: [remarkMath, remarkFactNotation], rehypePlugins: [[rehypeKatex, {trust: false}]], skipHtml: true}));
  expect(html).toContain('O_{X x P^1}(W)=p_X^*O_X(kH) tensor p_1^*O_{P^1}(e).\nnu^* omega_W');
  expect(html).toContain('Disc(W/X)=B_q+q_*Delta.');
  expect(html).not.toContain('<em>');
  expect(html).toContain('class="katex"');
  expect(html).toContain('<li>A list item with q_*R_q.</li>');
});
