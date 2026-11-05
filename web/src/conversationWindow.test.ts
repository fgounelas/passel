import { expect, it } from "vitest";
import { readingWindow, MAX_READING_CHARS, MAX_READING_MESSAGES, type ConversationMessage } from "./conversationWindow";
it("bounds retained history across thousands of loads in either direction without truncating messages", () => {
  for (const edge of ["start", "end"] as const) {
    let messages: ConversationMessage[] = [];
    for (let page = 0; page < 2000; page++) {
      const batch: ConversationMessage[] = Array.from({length: 40}, (_, i) => ({id: `${page}:${i}`, role: "assistant", text: "x".repeat(page % 3 ? 100 : 64000)}));
      const window = readingWindow(edge === "start" ? [...batch, ...messages] : [...messages, ...batch], edge);
      messages = window.messages;
      expect(messages.length).toBeLessThanOrEqual(MAX_READING_MESSAGES);
      expect(messages.reduce((sum, message) => sum + message.text.length, 0)).toBeLessThanOrEqual(MAX_READING_CHARS);
      expect(messages.every(message => message.text.length === 100 || message.text.length === 64000)).toBe(true);
      expect(edge === "start" ? messages[0].id : messages.at(-1)!.id).toBe(`${page}:${edge === "start" ? 0 : 39}`);
    }
  }
});
