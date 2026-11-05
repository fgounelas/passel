/** Claude's native multiline-paste envelope; preserve ordinary text verbatim. */
export function conversationUserText(text: string): string {
  const paste = /^\s*<pasted_content id="([A-Za-z0-9_-]{1,64})">\r?\n([\s\S]*)\r?\n<\/pasted_content id="\1">\s*$/.exec(text);
  return paste ? paste[2] : text;
}

export function matchesConversationReply(recorded: string, submitted: string): boolean {
  return recorded.trim() === submitted.trim() || conversationUserText(recorded).trim() === submitted.trim();
}
