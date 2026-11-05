import { expect, it } from "vitest";
import type { Root, Element } from "hast";
import { conversationHighlight } from "./conversationHighlight";
it("highlights literal, case-insensitive matches without interpreting regex or HTML", () => {
  const tree: Root = {type: "root", children: [{type: "text", value: "A+B and a+b <img>"}]};
  conversationHighlight("a+b")(tree);
  expect(tree.children.filter(node => node.type === "element")).toHaveLength(2);
  expect(tree.children.at(-1)).toEqual({type: "text", value: " <img>"});
});
it("leaves rendered math intact and bounds highlight markup", () => {
  const math: Element = {type: "element", tagName: "span", properties: {className: ["katex"]}, children: [{type: "text", value: "a"}]};
  const tree: Root = {type: "root", children: [math, {type: "text", value: "a".repeat(20_000)}]};
  conversationHighlight("a")(tree);
  expect(math.children).toEqual([{type: "text", value: "a"}]);
  expect(tree.children.filter(node => node.type === "element" && node.tagName === "mark")).toHaveLength(500);
  expect(tree.children.at(-1)).toEqual({type: "text", value: "a".repeat(19_500)});
});
