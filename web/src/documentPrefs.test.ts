// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { parseDocumentPrefs, updateDocumentPrefs } from "./documentPrefs";
import { documentPositionKey, readPosition, savePosition } from "./documentPosition";

beforeEach(() => localStorage.clear());
it("defaults malformed preferences and preserves independent choices", () => {
  expect(parseDocumentPrefs("broken")).toEqual({ pdfFit: "width", rememberPosition: true, markdownMode: "preview", rememberFolders: true });
  updateDocumentPrefs({ pdfFit: "page", rememberPosition: false });
  updateDocumentPrefs({ markdownMode: "source" });
  expect(parseDocumentPrefs(localStorage.getItem("herdr-document-preferences"))).toEqual({ pdfFit: "page", rememberPosition: false, markdownMode: "source", rememberFolders: true });
});
it("retains reading position across refresh URLs without confusing files", () => {
  const first = documentPositionKey("/file?root=work&path=a.pdf&v=1");
  expect(documentPositionKey("/file?root=work&path=a.pdf&v=9")).toBe(first);
  expect(documentPositionKey("/file?root=work&path=b.pdf&v=1")).not.toBe(first);
  savePosition(first, { page: 174, fraction: .3 });
  expect(readPosition(first)).toEqual({ page: 174, fraction: .3 });
});
it("bounds history and rejects corrupt positions", () => {
  for (let i = 0; i < 105; i++) savePosition(String(i), { page: i, fraction: 0 });
  expect(readPosition("0")).toBeNull();
  expect(readPosition("104")?.page).toBe(104);
  localStorage.setItem("herdr-document-positions", '{"bad":{"page":-1,"fraction":2}}');
  expect(readPosition("bad")).toBeNull();
});
