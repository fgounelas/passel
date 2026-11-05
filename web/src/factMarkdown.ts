import type { Processor } from "unified";

export function splitFactMarkdown(path: string, text: string) {
  if (!/(?:^|\/)facts\/[^/]+\.md$/i.test(path)) return null;
  const match = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match || !/^fact_id:\s*[^\r\n]+$/m.test(match[1])) return null;
  return {metadata: match[1], body: text.slice(match[0].length)};
}

// Fact records often use un-delimited notation such as q_*Delta and nu^*.
// Keep those symbols literal instead of pairing them into Markdown emphasis.
// Headings, lists, code, links and explicitly delimited math still parse normally.
export function remarkFactNotation(this: Processor) {
  const data = this.data();
  const extensions = data.micromarkExtensions || (data.micromarkExtensions = []);
  extensions.push({disable: {null: ["attention"]}});
}
