import { expect, it, vi } from "vitest";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { withPdfPage } from "./pdfResources";

it("waits for overlapping render/search consumers and cleans up on failure", async () => {
  const cleanup = vi.fn(() => true);
  const page = { cleanup } as unknown as PDFPageProxy;
  const pdf = { getPage: async () => page } as unknown as PDFDocumentProxy;
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const render = withPdfPage(pdf, 1, async () => pending);
  await withPdfPage(pdf, 1, async () => "text");
  expect(cleanup).not.toHaveBeenCalled();
  finish();
  await render;
  expect(cleanup).toHaveBeenCalledOnce();
  await expect(withPdfPage(pdf, 1, async () => { throw new Error("cancelled"); })).rejects.toThrow("cancelled");
  expect(cleanup).toHaveBeenCalledTimes(2);
});
