import { useDocumentPrefs } from "./documentPrefs";
import { documentPositionKey, useReadingPosition } from "./documentPosition";
import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, Util } from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { withPdfPage } from "./pdfResources";
import { findPdfMatches } from "./pdfSearch";
import type { PdfMatch } from "./pdfSearch";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
GlobalWorkerOptions.workerSrc = workerUrl;

// Only rasterize nearby pages, keeping long papers from exhausting browser memory.
function PdfPage({ pdf, page, width: availableWidth, fitHeight, scrollRoot, matches, active }: {
  pdf: PDFDocumentProxy; page: number; width: number; fitHeight?: number; scrollRoot: HTMLDivElement | null;
  matches: PdfMatch[]; active?: PdfMatch;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [aspect, setAspect] = useState(Math.SQRT2);
  const width = fitHeight ? Math.min(availableWidth, fitHeight / aspect) : availableWidth;
  const [error, setError] = useState(false);
  const [boxes, setBoxes] = useState<{ left: number; top: number; width: number; height: number; active: boolean }[]>([]);
  useEffect(() => {
    if (!holder.current || !scrollRoot) return;
    const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting),
      { root: scrollRoot, rootMargin: "300px 0px" });
    observer.observe(holder.current);
    return () => observer.disconnect();
  }, [scrollRoot]);
  useEffect(() => {
    if (!visible || !canvas.current) return;
    let cancelled = false;
    let rendering: RenderTask | undefined;
    const element = canvas.current;
    setError(false);
    void withPdfPage(pdf, page, async pdfPage => {
      if (cancelled) return;
      const base = pdfPage.getViewport({ scale: 1 });
      setAspect(base.height / base.width);
      const viewport = pdfPage.getViewport({ scale: width / base.width });
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(4_000_000 / (viewport.width * viewport.height)));
      element.width = Math.ceil(viewport.width * ratio);
      element.height = Math.ceil(viewport.height * ratio);
      rendering = pdfPage.render({ canvas: element, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      await rendering.promise;
    }).catch(() => { if (!cancelled) setError(true); });
    return () => {
      cancelled = true;
      rendering?.cancel();
      // Detached canvases can keep their backing store until a later GC.
      element.width = 0;
      element.height = 0;
    };
  }, [pdf, page, visible, width]);
  useEffect(() => {
    let cancelled = false;
    setBoxes([]);
    if (!visible || !matches.length) return;
    void withPdfPage(pdf, page, async p => {
      if (cancelled) return;
      const base = p.getViewport({ scale: 1 });
      const viewport = p.getViewport({ scale: width / base.width });
      const text = await p.getTextContent();
      const items = text.items.filter((i): i is TextItem => "str" in i);
      const found = new Set(matches.flatMap(m => m.items));
      const next = items.flatMap((item, i) => {
        if (!found.has(i)) return [];
        const transform = Util.transform(viewport.transform, item.transform);
        const height = Math.hypot(transform[2], transform[3]);
        return [{ left: transform[4], top: transform[5] - height,
          width: Math.max(2, item.width * viewport.scale), height,
          active: Boolean(active?.items.includes(i)) }];
      });
      if (!cancelled) setBoxes(next);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [pdf, page, width, visible, matches, active]);
  useEffect(() => {
    if (active) holder.current?.scrollIntoView({ block: "start" });
  }, [active]);
  useEffect(() => {
    if (active) holder.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "center" });
  }, [active, boxes]);
  return <div ref={holder} className="output-pdf-page" style={{ width, height: width * aspect }}>
    {visible && <canvas key={width} ref={canvas} aria-label={`PDF page ${page}`} />}
    {boxes.map((box, i) => <span key={i} className="output-pdf-match" data-active={box.active}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }} />)}
    {error && <p role="alert">Unable to render this page. Try Download.</p>}
  </div>;
}

export default function OutputPdfViewer({ url }: { url: string }) {
  const prefs = useDocumentPrefs();
  const [height, setHeight] = useState(600);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(400);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  useReadingPosition(scrollRoot, documentPositionKey(url), Boolean(pdf), prefs.rememberPosition);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<PdfMatch[]>([]);
  const [matchIndex, setMatchIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setMatches([]); setMatchIndex(0); setSearchError(false);
    setSearching(Boolean(pdf && query.trim()));
    if (!pdf || !query.trim()) return;
    const timer = window.setTimeout(() => { void (async () => {
      const results: PdfMatch[] = [];
      for (let page = 1; page <= pdf.numPages && results.length < 1000; page++) {
        if (cancelled) return;
        await withPdfPage(pdf, page, async p => {
          if (cancelled) return;
          const text = await p.getTextContent();
          if (cancelled) return;
          const items = text.items.filter((i): i is TextItem => "str" in i);
          results.push(...findPdfMatches(items, query, page).slice(0, 1000 - results.length));
        });
      }
      if (!cancelled) { setMatches(results); setSearching(false); }
    })().catch(() => { if (!cancelled) { setSearching(false); setSearchError(true); } }); }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [pdf, query]);
  const navigate = (delta: number) => setMatchIndex(i => matches.length ? (i + delta + matches.length) % matches.length : 0);
  useEffect(() => {
    if (!scrollRoot) return;
    const resize = () => {
      setWidth(Math.max(120, scrollRoot.clientWidth - 24));
      setHeight(Math.max(120, scrollRoot.clientHeight - 24));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(scrollRoot);
    return () => observer.disconnect();
  }, [scrollRoot]);
  useEffect(() => {
    let disposed = false;
    setPdf(null); setError(""); setZoom(1);
    const task = getDocument({ url, disableFontFace: true,
      disableAutoFetch: true, disableStream: true, canvasMaxAreaInBytes: 16_000_000,
      useSystemFonts: false, useWasm: false, maxImageSize: 16_000_000,
      standardFontDataUrl: "/pdf-assets/standard_fonts/", cMapUrl: "/pdf-assets/cmaps/", cMapPacked: true });
    void task.promise.then(value => { if (!disposed) setPdf(value); })
      .catch(() => { if (!disposed) setError("PDF could not be displayed. Try Refresh or Download."); });
    return () => { disposed = true; void task.destroy(); };
  }, [url]);
  const minimize = () => setExpanded(false);
  return <div className="output-pdf" data-expanded={expanded} onKeyDown={e => {
    if (e.key === "Escape" && expanded) { e.stopPropagation(); e.preventDefault(); minimize(); }
  }}>
    <div className="output-controls output-pdf-toolbar output-pdf-search">
      <button disabled={zoom <= .5} onClick={() => setZoom(z => Math.max(.5, z - .25))}
        aria-label="Zoom out PDF" title="Zoom out PDF">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <circle cx="12" cy="12" r="9" /><path d="M8 12h8" />
        </svg>
      </button>
      <button disabled={zoom >= 3} onClick={() => setZoom(z => Math.min(3, z + .25))}
        aria-label="Zoom in PDF" title="Zoom in PDF">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <circle cx="12" cy="12" r="9" /><path d="M8 12h8m-4-4v8" />
        </svg>
      </button>
      <input type="search" aria-label="Search PDF" placeholder="Search PDF…" value={query} maxLength={200}
        onChange={e => setQuery(e.target.value)} onKeyDown={e => {
          if (e.key === "Enter") { e.preventDefault(); navigate(e.shiftKey ? -1 : 1); }
        }} />
      <span role="status">{searching ? "Searching…" : searchError ? "Search unavailable" : query.trim() ?
        matches.length ? `${matchIndex + 1}/${matches.length}${matches.length === 1000 ? "+" : ""}` : "No matches" : ""}</span>
      <button disabled={!matches.length} onClick={() => navigate(-1)} aria-label="Previous search result">↑</button>
      <button disabled={!matches.length} onClick={() => navigate(1)} aria-label="Next search result">↓</button>
      <button className="output-pdf-fullscreen" aria-label={expanded ? "Minimize PDF" : "Fullscreen PDF"}
        title={expanded ? "Minimize PDF" : "Fullscreen PDF"} aria-pressed={expanded} onClick={() => {
          if (expanded) minimize();
          else setExpanded(true);
        }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d={expanded ? "M3 3l6 6m0-5v5H4m17-6-6 6m0-5v5h5M3 21l6-6m-5 0h5v5m12 1-6-6m0 5v-5h5" :
            "M9 9 3 3m0 5V3h5m7 6 6-6m-5 0h5v5M9 15l-6 6m5 0H3v-5m12-1 6 6m0-5v5h-5"} />
        </svg></button>
    </div>
    {error && <p role="alert">{error}</p>}
    {!pdf && !error && <p role="status">Loading PDF…</p>}
    <div className="output-pdf-scroll" ref={setScrollRoot}>
      {pdf && Array.from({ length: pdf.numPages }, (_, i) => <PdfPage key={`${url}:${i}`} pdf={pdf}
        page={i + 1} width={width * zoom} fitHeight={prefs.pdfFit === "page" ? height * zoom : undefined} scrollRoot={scrollRoot}
        matches={matches.filter(m => m.page === i + 1)} active={matches[matchIndex]?.page === i + 1 ? matches[matchIndex] : undefined} />)}
    </div>
  </div>;
}
