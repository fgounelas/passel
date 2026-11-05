import type { ConversationMessage } from "./conversationWindow";

export type ConversationPin = ConversationMessage & { session: string };
export type PinPage = { pins: ConversationPin[]; ids: string[]; hasMore: boolean; nextOffset: number };

async function bookmarkRequest(body: object, signal?: AbortSignal) {
  const response = await fetch("/api/project-files/conversation/bookmarks", {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: {"Content-Type": "application/json", "X-Herdr-Conversation": "1"},
    body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Bookmarks are unavailable. Try again.");
  return value;
}

export async function loadConversationPins(session: string, offset = 0, signal?: AbortSignal): Promise<PinPage> {
  const page = await bookmarkRequest({action: "list", session, offset}, signal) as PinPage;
  if (!Array.isArray(page.pins) || page.pins.length > 100 || !Array.isArray(page.ids) || page.ids.length > 1000 ||
      page.pins.reduce((n, p) => n + p.text.length, 0) > 500_000) throw new Error("Invalid bookmarks response.");
  return page;
}

export async function saveConversationPin(pane: string, session: string, message: string, add: boolean): Promise<void> {
  await bookmarkRequest(add ? {action: "add", pane, session, message} : {action: "remove", session, message});
}

export const MESSAGE_SHORTCUTS = [
  "Give me a status update since I last asked.",
  "What are the workers currently working on?",
  "What has been verified, and what remains conjectural?",
  "What is the main obstacle, and what are the next steps?",
  "Summarise the latest results and link to the relevant files.",
  "Gracefully stop all workers and double check no processes associated to this project are using tokens.",
];
