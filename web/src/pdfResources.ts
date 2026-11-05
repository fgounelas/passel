import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

const users = new WeakMap<PDFPageProxy, number>();

// Rendering and text extraction may overlap on the same cached page. Release
// decoded images/operator lists only once all current consumers have finished.
export async function withPdfPage<T>(
  pdf: PDFDocumentProxy, pageNumber: number,
  consume: (page: PDFPageProxy) => Promise<T>,
): Promise<T> {
  const page = await pdf.getPage(pageNumber);
  users.set(page, (users.get(page) ?? 0) + 1);
  try {
    return await consume(page);
  } finally {
    const remaining = (users.get(page) ?? 1) - 1;
    if (remaining) users.set(page, remaining);
    else {
      users.delete(page);
      page.cleanup();
    }
  }
}
