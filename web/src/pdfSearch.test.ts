import { describe, expect, it } from "vitest";
import { findPdfMatches } from "./pdfSearch";
describe("PDF search", () => {
  it("finds case-insensitive phrases across text runs and repeated matches", () => {
    const result = findPdfMatches([{str:"A theorem"}, {str:"of curves. THEOREM of curves."}], "theorem of", 3);
    expect(result).toHaveLength(2);
    expect(result[0].items).toEqual([0, 1]);
    expect(result[1].page).toBe(3);
  });
  it("handles blanks, absent words, and special characters literally", () => {
    expect(findPdfMatches([{str:"[X]"}], "[x]", 1)).toHaveLength(1);
    expect(findPdfMatches([{str:"hello"}], " ", 1)).toEqual([]);
    expect(findPdfMatches([{str:"hello"}], "bye", 1)).toEqual([]);
  });
});
