import { previousPrompt } from "./conversationNavigation";
import { ConversationChoice } from "./ConversationChoice";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useId } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import { ArrowDown, ArrowUp, Bookmark, CircleX, MoreVertical, X } from "lucide-react";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { AgentStatus } from "./types";
import { useCommandDraft, useConversationOutgoing } from "./commandDrafts";
import { normalizeMarkdownMath } from "./markdownMath";
import "katex/dist/katex.min.css";
import "./conversation.css";
import { conversationFiles, localFilePath } from "./conversationFiles";
import { ConversationFileLink } from "./ConversationFileLink";
import { conversationHighlight } from "./conversationHighlight";
import { ActionMenu } from "./overlays";
import { MESSAGE_SHORTCUTS, loadConversationPins, saveConversationPin, type PinPage } from "./conversationPins";
import { readingWindow, type ConversationMessage as Message } from "./conversationWindow";
import { conversationUserText, matchesConversationReply } from "./conversationUserText";

type HistoryPage = { messages: Message[]; before: number; after: number; hasEarlier: boolean; hasLater: boolean; nextCursor?: number; fileSize?: number };
type Activity = { id: string; command: string; output: string };
type Conversation = { activity?: Activity | null; turnActive?: boolean | null; status: "ok" | "unavailable" | "stale"; session?: string; messages: Message[]; awaitingFirstMessage?: boolean; earlier?: boolean };

const MessageBody = memo(function MessageBody({ text, highlight = "" }: { text: string; highlight?: string }) {
  const markdown = useMemo(() => normalizeMarkdownMath(text), [text]);
  return <ReactMarkdown skipHtml urlTransform={url => localFilePath(url) ?? defaultUrlTransform(url)} remarkPlugins={[remarkGfm, remarkMath]}
    rehypePlugins={[[rehypeKatex, { trust: false, strict: "ignore", maxExpand: 200, maxSize: 20 }], conversationFiles, [conversationHighlight, highlight]]}
    components={{ img: ({ alt }) => <span>[Image: {alt || "omitted"}]</span>,
      a: ({ href, children }) => <ConversationFileLink href={href}>{children}</ConversationFileLink> }}>
    {markdown}
  </ReactMarkdown>;
});

export function ConversationView({ paneId, bridgeId, agentStatus = "unknown", searchOpen = false, onCloseSearch = () => {}, pinsOpen = false, onPinsOpenChange = () => {} }: { paneId: string; bridgeId: string; agentStatus?: AgentStatus; searchOpen?: boolean; onCloseSearch?: () => void; pinsOpen?: boolean; onPinsOpenChange?: (open: boolean) => void }) {
  const [choiceActive, setChoiceActive] = useState(false);
  const [pinPage, setPinPage] = useState<PinPage>({pins: [], ids: [], hasMore: false, nextOffset: 0});
  const [pinOffset, setPinOffset] = useState(0);
  const [pinRevision, setPinRevision] = useState(0);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState("");
  const [copyNotice, setCopyNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [pinMenu, setPinMenu] = useState<{ message: Message; x: number; y: number } | null>(null);
  const [jumpMessageId, setJumpMessageId] = useState<string | null>(null);
  const pendingJump = useRef<string | null>(null);
  const promptCursor = useRef<number | null>(null);
  const promptScrollTop = useRef<number | null>(null);
  const promptAbort = useRef<AbortController | null>(null);
  const [promptBusy, setPromptBusy] = useState(false);
  const [noEarlierPrompt, setNoEarlierPrompt] = useState(false);
  const cancelPromptNavigation = useCallback(() => {
    promptAbort.current?.abort(); promptAbort.current = null;
    promptCursor.current = null; promptScrollTop.current = null;
    setPromptBusy(false); setNoEarlierPrompt(false);
  }, []);
  useEffect(() => () => promptAbort.current?.abort(), []);
  const composer = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useCommandDraft(bridgeId, paneId);

  const [sendStatus, setSendStatus] = useState("");
  const pending = useRef(false);
  const [outgoing, setOutgoing] = useConversationOutgoing(bridgeId, paneId);
  const sending = outgoing.some(entry => !entry.sent);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [data, setData] = useState<Conversation | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { setPinOffset(0); setPinPage({pins: [], ids: [], hasMore: false, nextOffset: 0}); setPinError(""); setCopyNotice(null); }, [data?.session]);
  useEffect(() => {
    if (!data?.session || data.awaitingFirstMessage) return;
    const session = data.session;
    const abort = new AbortController();
    let busy = false;
    const refresh = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const page = await loadConversationPins(session, pinOffset, abort.signal);
        if (!abort.signal.aborted) { setPinPage(page); setPinError(""); }
      } catch (cause) { if (!abort.signal.aborted) setPinError((cause as Error).message); }
      finally { busy = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    window.addEventListener("focus", refresh);
    return () => { abort.abort(); window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [data?.session, data?.awaitingFirstMessage, pinOffset, pinRevision]);
  const [limit, setLimit] = useState(40);
  const [history, setHistory] = useState<HistoryPage | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const historyPending = useRef(false);
  const historyEpoch = useRef(0);
  const [searchText, setSearchText] = useState("");
  const searchId = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (searchOpen) searchInput.current?.focus(); }, [searchOpen]);
  const [searchedText, setSearchedText] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchCursor, setSearchCursor] = useState<number | null>(null);
  const searchAbort = useRef<AbortController | null>(null);
  useEffect(() => () => searchAbort.current?.abort(), []);
  const [following, setFollowing] = useState(true);
  const [atScrollTop, setAtScrollTop] = useState(true);
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const lastScrollTop = useRef(0);
  const previousSession = useRef<string | undefined>(undefined);
  const previousHeight = useRef<number | null>(null);
  const readingAnchor = useRef<{id: string; top: number} | null>(null);
  const historyAbort = useRef<AbortController | null>(null);
  useEffect(() => () => historyAbort.current?.abort(), []);
  useEffect(() => {
    let disposed = false;
    let busy = false;
    let lastGood: Conversation | null = null;
    let unavailableSince: number | null = null;
    const abort = new AbortController();
    const refresh = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const response = await fetch(`/api/project-files/conversation?${new URLSearchParams({ pane: paneId })}`,
          { credentials: "same-origin", cache: "no-store", signal: abort.signal });
        if (!response.ok) throw new Error("Conversation unavailable");
        const next = await response.json() as Conversation;
        if (!Array.isArray(next.messages) || next.messages.length > 300) throw new Error("Invalid conversation");
        if (!disposed) {
          if (next.session && next.session !== previousSession.current) {
            cancelPromptNavigation();
            setPinMenu(null); setJumpMessageId(null); pendingJump.current = null;
            previousSession.current = next.session;
            follow.current = true;
            setFollowing(true);
            setLimit(40);
            setHistory(null);
            searchAbort.current?.abort(); setSearchedText(""); setSearching(false);
          }
          if (next.status === "ok") {
            lastGood = next; unavailableSince = null;
            setData(next);
          } else {
            unavailableSince ??= Date.now();
            if (lastGood?.messages.length && Date.now() - unavailableSince < 12_000) {
              // Discovery can briefly lose a process/file mapping. Keep the
              // bounded text visible, but disable replies until reconfirmed.
              setData({...lastGood, status: "stale"});
            } else {
              lastGood = null;
              setData(next); setHistory(null);
              searchAbort.current?.abort(); setSearching(false); setSearchedText("");
            }
          }
          setError(false);
        }
      } catch {
        if (!disposed) setError(true);
      } finally { busy = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      disposed = true; abort.abort(); window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [paneId, cancelPromptNavigation]);
  const loadHistory = async (direction: "before" | "after" | "start", cursor: number, targetMessage?: string) => {
    if (historyPending.current || !data?.session) return;
    searchAbort.current?.abort(); setSearching(false); setSearchedText("");
    const epoch = ++historyEpoch.current;
    historyPending.current = true; setHistoryBusy(true); setHistoryError("");
    const session = data.session;
    const abort = new AbortController(); historyAbort.current = abort;
    try {
      const response = await fetch(`/api/project-files/conversation/history?${new URLSearchParams({
        pane: paneId, session, direction, cursor: String(cursor),
      })}`, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) });
      if (!response.ok) throw new Error("Could not load history. Try again or return to latest messages.");
      const page = await response.json() as HistoryPage;
      if (!Array.isArray(page.messages) || page.messages.length > 40) throw new Error("Invalid history response");
      if (alive.current && previousSession.current === session && historyEpoch.current === epoch) {
        follow.current = false; setFollowing(false);
        const existing = history?.messages ?? readingWindow(data.messages.slice(-limit), "end").messages;
        if (direction === "start" || targetMessage) {
          if (targetMessage && !page.messages.some(message => message.id === targetMessage)) {
            throw new Error("The original message is no longer available in this conversation.");
          }
          readingAnchor.current = null; previousHeight.current = null;
          pendingJump.current = targetMessage ?? null; setJumpMessageId(targetMessage ?? null);
          const window = readingWindow(page.messages, "start");
          setHistory({...page, messages: window.messages,
            after: window.removedAfter ? Number(window.messages.at(-1)!.id) : page.after,
            hasLater: page.hasLater || window.removedAfter});
          if (scroll.current) scroll.current.scrollTop = 0;
        } else {
          const combined = direction === "before" ? [...page.messages, ...existing] : [...existing, ...page.messages];
          const unique = [...new Map(combined.map(message => [message.id, message])).values()];
          const window = readingWindow(unique, direction === "before" ? "start" : "end");
          const node = scroll.current;
          if (node && (window.removedBefore || window.removedAfter)) {
            const top = node.getBoundingClientRect().top;
            const anchor = [...node.querySelectorAll<HTMLElement>("article[data-message-id]")].find(article =>
              article.getBoundingClientRect().bottom > top && window.messages.some(message => message.id === article.dataset.messageId));
            if (anchor) readingAnchor.current = {id: anchor.dataset.messageId!, top: anchor.getBoundingClientRect().top};
            else if (direction === "before") node.scrollTop = 0;
          } else if (direction === "before") previousHeight.current = node?.scrollHeight ?? null;
          const next = direction === "before" ? {
            ...page, messages: unique,
            // Cached IDs are record starts; the next fetch may overlap the last
            // message, which is deduplicated above before rendering.
            after: history?.after ?? Number(existing.at(-1)?.id ?? page.after),
            hasLater: history?.hasLater ?? true,
          } : {...page, messages: unique, before: history?.before ?? page.before,
            hasEarlier: history?.hasEarlier ?? page.hasEarlier};
          setHistory({...next, messages: window.messages,
            before: window.removedBefore ? Number(window.messages[0].id) : next.before,
            after: window.removedAfter ? Number(window.messages.at(-1)!.id) : next.after,
            hasEarlier: next.hasEarlier || window.removedBefore,
            hasLater: next.hasLater || window.removedAfter});
        }
      }
    } catch (cause) {
      if (alive.current) setHistoryError(cause instanceof Error ? cause.message : "History unavailable.");
    } finally { historyPending.current = false; if (alive.current) setHistoryBusy(false); }
  };
  const search = async (cursor = 0, queryText = searchText) => {
    const query = queryText.trim();
    if (!query || !data?.session || historyPending.current) return;
    searchAbort.current?.abort();
    const abort = new AbortController(); searchAbort.current = abort;
    cancelPromptNavigation();
    const session = data.session;
    setSearching(true); setSearchedText(query); setHistoryError(""); setSearchCursor(null);
    follow.current = false; setFollowing(false);
    setHistory({messages: [], before: 0, after: 0, hasEarlier: false, hasLater: false});
    try {
      const matches: Message[] = [];
      let more = true;
      while (more && matches.length < 40 && matches.reduce((sum, message) => sum + message.text.length, 0) < 200_000 && !abort.signal.aborted) {
        const response = await fetch(`/api/project-files/conversation/history?${new URLSearchParams({
          pane: paneId, session, direction: "search", cursor: String(cursor), query,
        })}`, {credentials: "same-origin", cache: "no-store", signal: abort.signal});
        if (!response.ok) throw new Error("Search failed. Try again.");
        const page = await response.json() as HistoryPage;
        if (!Array.isArray(page.messages) || page.messages.length > 40 || typeof page.nextCursor !== "number") throw new Error("Invalid search response");
        if (abort.signal.aborted || previousSession.current !== session) return;
        // Keep all matches in this bounded page; at most 79 if a later batch fills it.
        matches.push(...page.messages);
        more = page.hasLater && page.nextCursor > cursor;
        cursor = page.nextCursor;
        setHistory({...page, messages: [...matches], hasEarlier: false, hasLater: false});
      }
      if (!abort.signal.aborted) setSearchCursor(more ? cursor : null);
    } catch (cause) {
      if (!abort.signal.aborted && alive.current) setHistoryError(cause instanceof Error ? cause.message : "Search unavailable.");
    } finally { if (!abort.signal.aborted && alive.current) setSearching(false); }
  };
  const showLatest = () => {
    cancelPromptNavigation();
    historyEpoch.current += 1;
    historyAbort.current?.abort();
    readingAnchor.current = null; previousHeight.current = null;
    pendingJump.current = null; setJumpMessageId(null);
    searchAbort.current?.abort(); setSearching(false); setSearchedText("");
    setHistory(null); setHistoryError(""); setLimit(40); follow.current = true; setFollowing(true);
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  };
  useEffect(() => {
    cancelPromptNavigation();
    if (!searchOpen) {
      searchAbort.current?.abort(); setSearching(false); setSearchedText("");
      setHistory(null); setHistoryError(""); setLimit(40);
      follow.current = true; setFollowing(true);
    }
  }, [searchOpen, cancelPromptNavigation]);
  useEffect(() => {
    if (data?.status !== "ok" || !data.session) return;
    setOutgoing(previous => {
      const consumed = new Set<string>();
      return previous.filter(entry => {
        if (data.session !== entry.session && !entry.first) return false;
        const match = data.messages.find(message => message.role === "user" && matchesConversationReply(message.text, entry.text) &&
          !entry.knownIds.includes(message.id) && !consumed.has(message.id));
        if (match) { consumed.add(match.id); return false; }
        return true;
      }).map(entry => entry.sent && !entry.unconfirmed && Date.now() - (entry.sentAt ?? 0) >= 30_000 ?
        {...entry, unconfirmed: true} : entry);
    });
  }, [data, setOutgoing]);
  const send = async () => {
    if (pending.current || sending || choiceActive || !draft.trim() || data?.status !== "ok" || !data.session || error) return;
    pending.current = true;
    const id = crypto.randomUUID();
    setOutgoing(previous => [...previous.slice(-9), {id, text: draft, session: data.session!, first: !!data.awaitingFirstMessage,
      knownIds: data.messages.map(message => message.id), sent: false}]);
    showLatest();
    setSendStatus("");
    try {
      const response = await fetch("/api/project-files/conversation/reply", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Herdr-Conversation": "1" },
        body: JSON.stringify({ pane: paneId, session: data.session, text: draft }),
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json() as { error?: string; status?: string };
      if (!response.ok) throw new Error(result.error || "Reply was not sent.");
      if (result.status !== "sent") throw new Error("Delivery could not be confirmed. Check Terminal before resending.");
      setDraft("", draft);
      setOutgoing(previous => previous.map(entry => entry.id === id ? {...entry, sent: true, sentAt: Date.now()} : entry));
      if (alive.current) setSendStatus("Input submitted.");
    } catch (cause) {
      setOutgoing(previous => previous.filter(entry => entry.id !== id));
      if (alive.current) {
        setSendStatus(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message :
          "Delivery could not be confirmed. Check the conversation before resending.");
      }
    } finally {
      pending.current = false;
    }
  };
  const messages = history?.messages ?? data?.messages ?? [];
  const atBeginning = atScrollTop && (history ? !history.hasEarlier : !data?.earlier &&
    readingWindow(messages.slice(-limit), "end").messages.length === messages.length);
  const showWorking = !choiceActive && agentStatus === "working" && data?.turnActive !== false && data?.status === "ok" && !error && !history;
  const loadEarlier = () => {
    if (historyBusy || promptBusy || searchedText || data?.status !== "ok" || data.awaitingFirstMessage) return;
    if (history) {
      if (history.hasEarlier) void loadHistory("before", history.before);
    } else if (messages.length > limit && limit < 80 && readingWindow(messages.slice(-limit), "end").messages.length === Math.min(limit, messages.length)) {
      previousHeight.current = scroll.current?.scrollHeight ?? null;
      follow.current = false; setFollowing(false); setLimit(value => value + 40);
    } else if (messages.length) {
      const visible = readingWindow(messages.slice(-limit), "end").messages;
      if (data.earlier || visible.length < messages.length) void loadHistory("before", Number(visible[0].id));
    }
  };
  useLayoutEffect(() => {
    const node = scroll.current;
    if (!node) return;
    if (pendingJump.current) {
      const target = [...node.querySelectorAll<HTMLElement>("article[data-message-id]")].find(article => article.dataset.messageId === pendingJump.current);
      if (target) {
        node.scrollTop += target.getBoundingClientRect().top - node.getBoundingClientRect().top - 12;
        if (promptCursor.current === Number(pendingJump.current)) promptScrollTop.current = node.scrollTop;
        target.focus({preventScroll: true}); pendingJump.current = null;
      }
    } else if (readingAnchor.current) {
      const anchor = [...node.querySelectorAll<HTMLElement>("article[data-message-id]")].find(article => article.dataset.messageId === readingAnchor.current!.id);
      if (anchor) node.scrollTop += anchor.getBoundingClientRect().top - readingAnchor.current.top;
      readingAnchor.current = null; previousHeight.current = null;
    } else if (previousHeight.current !== null) {
      node.scrollTop += node.scrollHeight - previousHeight.current;
      previousHeight.current = null;
    } else if (follow.current) node.scrollTop = node.scrollHeight;
    // Layout/history changes may move the viewport too. Keep the jump cursor
    // until the reader actually scrolls away, including repeated scroll events.
    if (promptCursor.current !== null) promptScrollTop.current = node.scrollTop;
    lastScrollTop.current = node.scrollTop;
    setAtScrollTop(node.scrollTop <= 1);
  }, [messages, limit, outgoing, showWorking, jumpMessageId]);
  const jumpToMessage = (id: string) => {
    if (historyPending.current || data?.status !== "ok") return;
    follow.current = false; setFollowing(false); setHistoryError("");
    const node = scroll.current;
    const target = [...(node?.querySelectorAll<HTMLElement>("article[data-message-id]") ?? [])].find(article => article.dataset.messageId === id);
    if (!searchedText && node && target) {
      setJumpMessageId(id);
      readingAnchor.current = null; previousHeight.current = null;
      // Also handle a second click on the same pin after the reader scrolls away.
      node.scrollTop += target.getBoundingClientRect().top - node.getBoundingClientRect().top - 12;
      target.focus({preventScroll: true}); pendingJump.current = null;
    } else {
      void loadHistory("after", Number(id), id);
    }
    if (window.matchMedia?.("(max-width: 820px)").matches) onPinsOpenChange(false);
  };
  const goToPreviousPrompt = async () => {
    if (historyPending.current || promptBusy || !data?.session || data.status !== "ok") return;
    const node = scroll.current;
    const top = (node?.getBoundingClientRect().top ?? 0) + 12;
    const firstVisible = [...(node?.querySelectorAll<HTMLElement>("article[data-message-id]") ?? [])]
      .find(article => article.getBoundingClientRect().bottom > top);
    const before = promptCursor.current ?? (follow.current ? Infinity : Number(firstVisible?.dataset.messageId ?? messages[0]?.id));
    const available = history?.messages ?? data.messages;
    const target = previousPrompt(available, before);
    if (target) {
      promptCursor.current = Number(target.id);
      jumpToMessage(target.id);
      if (node?.querySelector(`article[data-message-id="${target.id}"]`)) promptScrollTop.current = node.scrollTop;
      setNoEarlierPrompt(!previousPrompt(available, Number(target.id)) && !(history ? history.hasEarlier : data.earlier));
      return;
    }
    if (!(history ? history.hasEarlier : data.earlier)) { setNoEarlierPrompt(true); return; }
    const session = data.session;
    const abort = new AbortController(); promptAbort.current = abort;
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]);
    setPromptBusy(true); setHistoryError("");
    let cursor = Math.min(before, history?.before ?? Number(data.messages[0].id));
    try {
      // One bounded page at a time, including tool-only gaps; never accumulate pages.
      for (let pageNumber = 0; pageNumber < 64; pageNumber += 1) {
        const response = await fetch(`/api/project-files/conversation/history?${new URLSearchParams({
          pane: paneId, session, direction: "prompt", cursor: String(cursor),
        })}`, { credentials: "same-origin", cache: "no-store", signal });
        if (!response.ok) throw new Error("Could not find the previous prompt. Try again.");
        const page = await response.json() as HistoryPage;
        if (!Array.isArray(page.messages) || page.messages.length > 40 || !Number.isFinite(page.before)) throw new Error("Invalid history response");
        if (signal.aborted || previousSession.current !== session || !alive.current) return;
        const previous = previousPrompt(page.messages, before);
        if (previous) {
          const index = page.messages.findIndex(message => message.id === previous.id);
          const window = readingWindow(page.messages.slice(index), "start");
          follow.current = false; setFollowing(false);
          readingAnchor.current = null; previousHeight.current = null;
          promptCursor.current = Number(previous.id); pendingJump.current = previous.id; setJumpMessageId(previous.id);
          setHistory({...page, messages: window.messages, before: Number(previous.id),
            hasEarlier: page.hasEarlier || index > 0,
            after: window.removedAfter ? Number(window.messages.at(-1)!.id) : page.after,
            hasLater: page.hasLater || window.removedAfter});
          setNoEarlierPrompt(!previousPrompt(page.messages, Number(previous.id)) && !page.hasEarlier);
          return;
        }
        if (!page.hasEarlier || page.before >= cursor) { setNoEarlierPrompt(true); return; }
        cursor = page.before;
      }
      throw new Error("Earlier prompts are beyond this scan. Go to the top or scroll up to continue.");
    } catch (cause) {
      if (!abort.signal.aborted && alive.current && previousSession.current === session) setHistoryError(cause instanceof Error ? cause.message : "History unavailable.");
    } finally {
      if (promptAbort.current === abort) { promptAbort.current = null; if (alive.current) setPromptBusy(false); }
    }
  };
  const jumpToPin = (id: string) => { cancelPromptNavigation(); jumpToMessage(id); };
  const sessionPins = pinPage.pins;
  const isPinned = (message: Message) => pinPage.ids.includes(message.id);
  const copyMessage = async (message: Message) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable.");
      await navigator.clipboard.writeText(message.role === "user" ? conversationUserText(message.text) : message.text);
      if (alive.current) setCopyNotice({ text: "Message copied." });
    } catch {
      if (alive.current) setCopyNotice({ text: "Could not copy the message. Check clipboard permissions and try again.", error: true });
    }
  };
  const togglePin = async (message: Message) => {
    if (!data?.session || pinBusy) return;
    const session = data.session;
    const adding = !isPinned(message);
    setPinBusy(true); setPinError("");
    try {
      await saveConversationPin(paneId, session, message.id, adding);
      if (alive.current && previousSession.current === session) {
        setPinOffset(0); setPinRevision(value => value + 1);
        if (adding) onPinsOpenChange(true);
      }
    } catch (cause) { if (alive.current) setPinError((cause as Error).message); }
    finally { if (alive.current) setPinBusy(false); }
  };
  return <div className="conversation-layout">
    <section className="conversation-view" aria-label="Conversation">
    {pinError && <p role="alert" className="conversation-hint">{pinError}</p>}
    {copyNotice && <p role={copyNotice.error ? "alert" : "status"} className="conversation-hint">{copyNotice.text}</p>}
    {searchOpen && <form id={`${searchId}-form`} className="conversation-search" role="search"
      onKeyDown={event => { if (event.key === "Escape") { onCloseSearch(); showLatest(); } }} onSubmit={event => { event.preventDefault(); void search(); }}>
      <div className="conversation-search-field">
        <input ref={searchInput} type="search" aria-label="Search conversation" placeholder="Search conversation…" maxLength={200}
          value={searchText} onChange={event => setSearchText(event.target.value)} />
        <button className="icon-btn" type="button" aria-label="Clear search" title="Clear search"
          onClick={() => { setSearchText(""); showLatest(); searchInput.current?.focus(); }}><CircleX size={16} /></button>
      </div>
      <button type="submit" disabled={!searchText.trim() || data?.status !== "ok" || data.awaitingFirstMessage}>Search</button>
      {searching && <button type="button" onClick={() => { searchAbort.current?.abort(); setSearching(false); }}>Stop</button>}
    </form>}
    <div className="conversation-scroll" ref={scroll} tabIndex={0} aria-label="Conversation messages"
      onScroll={() => {
        const node = scroll.current;
        if (!node) return;
        setAtScrollTop(node.scrollTop <= 1);
        if (promptScrollTop.current !== null && Math.abs(node.scrollTop - promptScrollTop.current) < 1) {
          lastScrollTop.current = node.scrollTop;
          return;
        }
        promptCursor.current = null; promptScrollTop.current = null; setNoEarlierPrompt(false);
        follow.current = !history && node.scrollHeight - node.scrollTop - node.clientHeight < 64;
        setFollowing(follow.current);
        const movingDown = node.scrollTop > lastScrollTop.current;
        lastScrollTop.current = node.scrollTop;
        if (node.scrollTop <= 80) loadEarlier();
        else if (movingDown && history?.hasLater && !historyBusy && !searchedText && node.scrollHeight - node.scrollTop - node.clientHeight < 80) {
          void loadHistory("after", history.after);
        }
      }}>
      <div className="conversation-content">
        {historyBusy && <p className="conversation-hint" role="status">Loading history…</p>}
        {(error || data?.status !== "ok") && <p className="conversation-hint" role="status">{error ? "Updates disconnected. Retrying…" : !data ? "Loading conversation…" : data.status === "stale" ? "Conversation updates are temporarily unavailable." : choiceActive ? "The agent is waiting for your input below." : "No supported conversation is attached to this pane."}</p>}
        {historyError && <p role="alert">{historyError}</p>}
        {searchedText && <p className="conversation-hint" role="status">{searching ? "Searching saved conversation…" :
          `${messages.length} matching messages for “${searchedText}”${searchCursor !== null ? " · more available" : ""}`}</p>}
        {searchedText && searchCursor !== null && !searching && <button type="button" onClick={() => void search(searchCursor, searchedText)}>Next results</button>}
        {history && !searchedText && <p className="conversation-hint">Saved conversation history · {history.hasEarlier ? "earlier messages" : "beginning of session"}</p>}
        {data?.status === "ok" && messages.length === 0 && <p>{data.awaitingFirstMessage ?
          "The agent is connected. Send a message below to start the conversation." : "No conversation messages yet."}</p>}
        {(history ? messages : readingWindow(messages.slice(-limit), "end").messages).map(message => <article key={message.id} data-message-id={message.id} className="conversation-message" data-role={message.role} tabIndex={-1} data-jump-target={jumpMessageId === message.id}>

          <header><strong>{message.role === "user" ? "You" : "Assistant"}</strong>
            {message.timestamp && Number.isFinite(Date.parse(message.timestamp)) &&
              <time dateTime={message.timestamp}>{new Date(message.timestamp).toLocaleString()}</time>}
            {isPinned(message) && <Bookmark size={13} aria-label="Pinned message" />}
            <button className="icon-btn conversation-message-menu" type="button" aria-label="Message actions" title="Message actions"
              onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setCopyNotice(null); setPinMenu({message, x: rect.left, y: rect.bottom}); }}>
              <MoreVertical size={14} /></button></header>
          <MessageBody text={message.role === "user" ? conversationUserText(message.text) : message.text} highlight={searchedText} />
          {message.truncated && <p className="conversation-hint">Long message shortened. The full text remains in the original session.</p>}
        </article>)}
        {!history && outgoing.map(entry => <article key={`outgoing-${entry.id}`} className="conversation-message" data-role="user" data-pending="true">
          <header><strong>You</strong><span role="status">{!entry.sent ? "Sending…" : entry.unconfirmed ?
            "Not yet confirmed · check Terminal" : "Input submitted · awaiting the agent"}</span></header>
          <MessageBody text={entry.text} />
          {entry.unconfirmed && <p className="conversation-hint">It may still be queued. Check Terminal before sending again.</p>}
        </article>)}
    {showWorking && <section className="conversation-activity" aria-label="Current worker activity">
      <div className="conversation-activity-label" role="status">Working…</div>
      <div key={data?.activity?.id ?? "pending"} className="conversation-activity-preview" tabIndex={0} aria-label="Latest command and output">
        {data?.activity ? <><pre className="conversation-activity-command">{data.activity.command.slice(0, 2001)}</pre>
          {data.activity.output && <pre>{data.activity.output.slice(0, 4001)}</pre>}</> : null}
      </div>
    </section>}
      </div>
    </div>
    <ConversationChoice key={paneId} pane={paneId} onActive={setChoiceActive} />
    <form className="conversation-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
      <textarea ref={composer} aria-label="Reply to conversation" placeholder="Write a reply…" value={draft}
        disabled={sending || choiceActive} maxLength={16000} onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
            event.preventDefault(); void send();
          }
        }} />
      <div className="conversation-compose-actions">
        <span role="status">{sendStatus || "Enter for a new line · Ctrl/⌘ Enter to send"}</span>
        <select className="settings-select conversation-shortcuts" aria-label="Message shortcuts" value="" disabled={sending || choiceActive}
          onChange={event => {
            const text = MESSAGE_SHORTCUTS[Number(event.target.value)];
            if (!text) return;
            const next = draft ? `${draft}\n\n${text}` : text;
            if (next.length > 16000) { setSendStatus("The draft is too long to add this shortcut."); return; }
            setDraft(next); composer.current?.focus();
          }}>
          <option value="" disabled>Message shortcuts…</option>
          {MESSAGE_SHORTCUTS.map((text, index) => <option key={text} value={index}>{text}</option>)}
        </select>
        <button type="submit" disabled={sending || choiceActive || !draft.trim() || data?.status !== "ok" || error}>
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </form>
    {data?.status === "ok" && !data.awaitingFirstMessage && !searchOpen && messages.length > 0 && <div className="conversation-navigation">
      {!atBeginning && <>
        {!noEarlierPrompt && <button type="button" className="conversation-previous" disabled={historyBusy || promptBusy}
          title="Go to the previous message from you"
          onClick={() => void goToPreviousPrompt()}>{promptBusy ? "Finding prompt…" : "Previous prompt"}</button>}
        <button type="button" className="conversation-start" disabled={historyBusy} aria-label="Go to top" title="Go to top"
          onClick={() => { cancelPromptNavigation(); void loadHistory("start", 0); }}><ArrowUp size={14} aria-hidden="true" /></button>
      </>}
    </div>}
    {!following && messages.length > 0 && <button type="button" className="conversation-latest" aria-label="Go to bottom" title="Go to bottom" onClick={() => {
      showLatest();
    }}><ArrowDown size={14} aria-hidden="true" /></button>}
    {pinMenu && <ActionMenu x={pinMenu.x} y={pinMenu.y} title="Message"
      items={[{key: "pin", label: isPinned(pinMenu.message) ? "Unpin message" : "Pin message"}, {key: "copy", label: "Copy to clipboard"}]}
      onClose={() => setPinMenu(null)} onPick={key => {
        if (key === "copy") void copyMessage(pinMenu.message); else void togglePin(pinMenu.message);
        setPinMenu(null);
      }} />}
  </section>
  {pinsOpen && <aside className="conversation-pins" aria-label="Pinned messages">
    <header><strong>Pinned messages</strong><button className="icon-btn" type="button" aria-label="Close pinned messages"
      onClick={() => onPinsOpenChange(false)}><X size={16} /></button></header>
    <p className="conversation-hint">Saved on your server. Available across browsers and logins.</p>
    {!sessionPins.length && <p className="conversation-hint">Use a message’s three-dot menu to pin a question or response.</p>}
    {pinBusy && <p className="conversation-hint" role="status">Saving bookmark…</p>}
    <div className="conversation-pins-list">
      {sessionPins.map(pin => <div className="conversation-pin" key={pin.id}>
        <button className="conversation-pin-preview" type="button" title="Go to message in conversation" disabled={historyBusy || data?.status !== "ok"}
          onClick={() => jumpToPin(pin.id)}>
          <strong>{pin.role === "user" ? "You" : "Assistant"}</strong><span>{pin.text.slice(0, 240)}{pin.text.length > 240 ? "…" : ""}</span>
        </button>
        <button type="button" className="conversation-pin-remove" disabled={pinBusy} onClick={() => void togglePin(pin)}>Unpin</button>
      </div>)}
    </div>
    {(pinOffset > 0 || pinPage.hasMore) && <div className="conversation-pin-pages">
      {pinOffset > 0 && <button type="button" onClick={() => { setPinOffset(0);  }}>Newest pins</button>}
      {pinPage.hasMore && <button type="button" onClick={() => { setPinOffset(pinPage.nextOffset);  }}>Older pins</button>}
    </div>}
  </aside>}
  </div>;
}
