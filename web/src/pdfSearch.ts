import type { TextItem } from "pdfjs-dist/types/src/display/api";

export type PdfMatch = { page: number; start: number; end: number; items: number[] };
export function findPdfMatches(items: Pick<TextItem, "str">[], query: string, page: number): PdfMatch[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  let text = "";
  const ranges = items.map(item => {
    const start = text.length;
    text += item.str.toLocaleLowerCase() + " ";
    return [start, text.length - 1];
  });
  const matches: PdfMatch[] = [];
  for (let start = text.indexOf(needle); start !== -1 && matches.length < 1000; start = text.indexOf(needle, start + needle.length)) {
    const end = start + needle.length;
    matches.push({ page, start, end, items: ranges.flatMap(([a, b], i) => a < end && b > start ? [i] : []) });
  }
  return matches;
}
