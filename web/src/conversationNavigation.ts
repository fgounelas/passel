import type { ConversationMessage } from "./conversationWindow";

export function previousPrompt(messages: ConversationMessage[], before = Infinity) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" && Number(message.id) < before) return message;
  }
  return undefined;
}
