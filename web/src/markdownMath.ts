import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMath from "remark-math";

const parser = unified().use(remarkParse).use(remarkMath);
type Node = { type: string; position?: { start: { offset?: number }; end: { offset?: number } }; children?: Node[] };
const literalTypes = new Set(["code", "inlineCode", "html", "definition", "link", "image", "math", "inlineMath"]);

// remark-math accepts dollar delimiters. Normalize the other standard LaTeX
// delimiters before Markdown consumes their backslashes as punctuation escapes.
// Use Markdown source ranges to leave code, links and existing math untouched.
export function normalizeMarkdownMath(source: string): string {
  if (!source.includes("\\(") && !source.includes("\\[")) return source;
  const protectedRanges: [number, number][] = [];
  const visit = (node: Node) => {
    if (literalTypes.has(node.type)) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) protectedRanges.push([start, end]);
      return;
    }
    node.children?.forEach(visit);
  };
  visit(parser.parse(source));
  const convert = (text: string) => text.replace(
    /(?<!\\)\\\(([\s\S]*?)(?<!\\)\\\)|(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g,
    (_, inline: string | undefined, display: string | undefined) => inline !== undefined
      ? `$${inline.trim()}$` : `\n$$\n${display!.trim()}\n$$\n`,
  );
  let end = 0;
  let output = "";
  for (const [start, next] of protectedRanges) {
    output += convert(source.slice(end, start)) + source.slice(start, next);
    end = next;
  }
  return output + convert(source.slice(end));
}
