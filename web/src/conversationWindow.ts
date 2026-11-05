export type ConversationMessage = { id: string; role: "user" | "assistant"; text: string; truncated?: boolean; timestamp?: string };
export const MAX_READING_MESSAGES = 80;
export const MAX_READING_CHARS = 200_000;

// Keep the end being read. Evicted messages remain available from the source.
export function readingWindow<T extends ConversationMessage>(messages: T[], edge: "start" | "end") {
  let start = 0, end = messages.length;
  let chars = messages.reduce((sum, message) => sum + message.text.length, 0);
  while (end - start > 1 && (end - start > MAX_READING_MESSAGES || chars > MAX_READING_CHARS)) {
    chars -= messages[edge === "start" ? --end : start++].text.length;
  }
  return {messages: messages.slice(start, end), removedBefore: start > 0, removedAfter: end < messages.length};
}
