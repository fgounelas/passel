import { expect, it } from "vitest";
import { conversationUserText, matchesConversationReply } from "./conversationUserText";

it("recognises Claude's complete paste envelope while preserving the user's text", () => {
  const text = "Write up the result.\n\n1) Explain every step.\n2) Cite original sources.";
  const recorded = `\n\n<pasted_content id="a5b6">\n${text}\n</pasted_content id="a5b6">\n`;
  expect(conversationUserText(recorded)).toBe(text);
  expect(matchesConversationReply(recorded, text)).toBe(true);
  expect(matchesConversationReply(recorded, recorded)).toBe(true);
  expect(matchesConversationReply(recorded, text + " Also restart the workers.")).toBe(false);
});

it("does not turn fragments, malformed wrappers or similar messages into acknowledgements", () => {
  for (const recorded of [
    '<pasted_content id="a5b6">\nRequest\n</pasted_content id="other">',
    '<pasted_content id="a5b6">\nRequest',
    'Quoted text: <pasted_content id="a5b6">\nRequest\n</pasted_content id="a5b6">',
    '<pasted_content id="a5b6">\nRequest\n</pasted_content id="a5b6">\nExtra content',
    'Request with a different meaning',
  ]) {
    expect(conversationUserText(recorded)).toBe(recorded);
    expect(matchesConversationReply(recorded, "Request")).toBe(false);
  }
  expect(conversationUserText("  Ordinary text\n")).toBe("  Ordinary text\n");
  expect(matchesConversationReply("Request", " Request\n")).toBe(true);
  expect(matchesConversationReply("Line one\nLine two", "Line one Line two")).toBe(false);
});
