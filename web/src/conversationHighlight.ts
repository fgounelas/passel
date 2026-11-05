import type { Root, RootContent, Element, Text } from "hast";

// Work on rendered text nodes, preserving Markdown structure and escaping.
// Leave KaTeX's generated markup untouched.
export function conversationHighlight(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return () => {};
  const pattern = new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  return (tree: Root) => {
    let remaining = 500; // A short/common query must not create unbounded markup.
    function visit(parent: Root | Element) {
      if (parent.type === "element" && (parent.tagName === "mark" ||
        String(parent.properties.className ?? "").includes("katex"))) return;
      parent.children = (parent.children as RootContent[]).flatMap<RootContent>(child => {
        if (child.type === "element") { visit(child); return [child]; }
        if (child.type !== "text" || !remaining) return [child];
        const pieces: (Text | Element)[] = [];
        let start = 0;
        for (const match of child.value.matchAll(pattern)) {
          if (remaining === 0) break;
          remaining -= 1;
          const index = match.index!;
          if (index > start) pieces.push({type: "text", value: child.value.slice(start, index)});
          pieces.push({type: "element", tagName: "mark", properties: {className: ["conversation-search-match"]},
            children: [{type: "text", value: match[0]}]});
          start = index + match[0].length;
        }
        if (!pieces.length) return [child];
        if (start < child.value.length) pieces.push({type: "text", value: child.value.slice(start)});
        return pieces;
      }) as typeof parent.children;
    }
    visit(tree);
  };
}
