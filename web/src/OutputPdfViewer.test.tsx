import { updateDocumentPrefs } from "./documentPrefs";
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const pdf = vi.hoisted(() => ({numPages: 3, getPage: vi.fn(async () => ({
  getViewport: ({scale}: {scale:number}) => ({width:600*scale,height:800*scale,scale,transform:[scale,0,0,-scale,0,800*scale]}),
  cleanup: vi.fn(() => true),
  render: () => ({promise:Promise.resolve(),cancel:vi.fn()}),
  getTextContent: async () => ({items:[{str:"A theorem",width:80,transform:[10,0,0,10,20,700]}]}),
}))}));
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions:{},
  getDocument: () => ({promise:Promise.resolve(pdf),destroy:vi.fn(async () => {})}),
  Util: {transform: () => [10,0,0,10,20,100]},
}));
import OutputPdfViewer from "./OutputPdfViewer";
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML=""; });
it("renders continuous pages, uses +/- zoom, searches, and expands/minimizes without page navigation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  vi.stubGlobal("ResizeObserver",class { observe() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver",class {
    callback: (entries: {isIntersecting:boolean}[]) => void;
    constructor(callback: (entries: {isIntersecting:boolean}[]) => void) { this.callback=callback; }
    observe() { this.callback([{isIntersecting:true}]); } disconnect() {}
  });
  Element.prototype.scrollIntoView=vi.fn();
  const container=document.createElement("div"); document.body.append(container);
  const root=createRoot(container);
  const tick=() => new Promise(resolve=>setTimeout(resolve,0));
  const button=(label:string) => container.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
  try {
    await act(async()=>{root.render(<OutputPdfViewer url="/test.pdf"/>);await tick();});
    expect(container.querySelectorAll("canvas")).toHaveLength(3);
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector('input[type="number"]')).toBeNull();
    const initialWidth = (container.querySelector(".output-pdf-page") as HTMLElement).style.width;
    await act(async()=>{button("Zoom in PDF").click();await tick();});
    expect(parseFloat((container.querySelector(".output-pdf-page") as HTMLElement).style.width)).toBe(parseFloat(initialWidth) * 1.25);
    await act(async()=>{button("Zoom out PDF").click();await tick();});
    expect((container.querySelector(".output-pdf-page") as HTMLElement).style.width).toBe(initialWidth);
    await act(async()=>{button("Fullscreen PDF").click();await tick();});
    expect(container.querySelector('.output-pdf')?.getAttribute('data-expanded')).toBe('true');
    await act(async()=>{button("Minimize PDF").click();await tick();});
    expect(container.querySelector('.output-pdf')?.getAttribute('data-expanded')).toBe('false');
    await act(async () => { updateDocumentPrefs({ pdfFit: "page" }); await tick(); });
    expect(parseFloat((container.querySelector(".output-pdf-page") as HTMLElement).style.height)).toBeLessThanOrEqual(120);
    await act(async () => { updateDocumentPrefs({ pdfFit: "width" }); await tick(); });
    expect((container.querySelector(".output-pdf-page") as HTMLElement).style.width).toBe(initialWidth);
    const input=container.querySelector('[aria-label="Search PDF"]') as HTMLInputElement;
    await act(async()=>{
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'theorem');
      input.dispatchEvent(new Event('input',{bubbles:true}));
      await tick();
    });
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,350));});
    expect(container.querySelector('.output-pdf-search [role="status"]')?.textContent).toBe('1/3');
    expect(container.querySelectorAll('.output-pdf-match')).toHaveLength(3);
    await act(async()=>{button("Next search result").click();await tick();});
    expect(container.querySelector('.output-pdf-search [role="status"]')?.textContent).toBe('2/3');
  } finally {await act(async()=>root.unmount());}
});

it("releases raster buffers and page resources while scrolling a 350-page PDF", async () => {
  pdf.numPages = 350;
  pdf.getPage.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const observers: ((entries: {isIntersecting: boolean}[]) => void)[] = [];
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: (entries: {isIntersecting: boolean}[]) => void) { observers.push(callback); }
    observe() {} disconnect() {}
  });
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<OutputPdfViewer url="/large.pdf" />); });
    expect(observers).toHaveLength(350);
    expect(pdf.getPage).not.toHaveBeenCalled();
    let previous: HTMLCanvasElement | null = null;
    for (let page = 0; page < 350; page++) {
      await act(async () => {
        if (page) observers[page - 1]([{isIntersecting: false}]);
        observers[page]([{isIntersecting: true}]);
      });
      if (previous) { expect(previous.width).toBe(0); expect(previous.height).toBe(0); }
      expect(container.querySelectorAll("canvas")).toHaveLength(1);
      previous = container.querySelector("canvas");
      const proxy = await pdf.getPage.mock.results[page].value;
      expect(proxy.cleanup).toHaveBeenCalledOnce();
    }
    await act(async () => { root.unmount(); });
    expect(previous!.width).toBe(0);
    expect(previous!.height).toBe(0);
  } finally {
    pdf.numPages = 3;
    await act(async () => root.unmount());
  }
});

it("cancels unfinished renders and frees old buffers across fullscreen size changes", async () => {
  const original = pdf.getPage.getMockImplementation()!;
  const proxy = await original();
  const tasks: {cancel: ReturnType<typeof vi.fn>}[] = [];
  proxy.render = () => {
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((_, fail) => { reject = fail; });
    const cancel = vi.fn(() => reject(new Error("RenderingCancelledException")));
    tasks.push({cancel});
    return {promise, cancel};
  };
  pdf.getPage.mockImplementation(async () => proxy);
  pdf.numPages = 350;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("devicePixelRatio", 2);
  const resizes: (() => void)[] = [];
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resizes.push(callback); }
    observe() {} disconnect() {}
  });
  let observed = 0;
  vi.stubGlobal("IntersectionObserver", class {
    callback: (entries: {isIntersecting: boolean}[]) => void;
    constructor(callback: (entries: {isIntersecting: boolean}[]) => void) { this.callback = callback; }
    observe() { this.callback([{isIntersecting: observed++ === 0}]); }
    disconnect() {}
  });
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<OutputPdfViewer url="/large.pdf" />); });
    const scroller = container.querySelector('.output-pdf-scroll')!;
    for (let cycle = 0; cycle < 20; cycle++) {
      const oldCanvas = container.querySelector('canvas')!;
      const oldTask = tasks.at(-1)!;
      await act(async () => {
        const label = cycle % 2 ? "Minimize PDF" : "Fullscreen PDF";
        (container.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click();
        Object.defineProperty(scroller, 'clientWidth', {configurable: true, value: cycle % 2 ? 424 : 3024});
        resizes.forEach(resize => resize());
      });
      expect(oldTask.cancel).toHaveBeenCalledOnce();
      expect(oldCanvas.width * oldCanvas.height).toBe(0);
      const canvases = container.querySelectorAll('canvas');
      expect(canvases).toHaveLength(1);
      expect(canvases[0].width * canvases[0].height).toBeLessThan(4_010_000);
    }
    const lastCanvas = container.querySelector('canvas')!;
    await act(async () => root.unmount());
    expect(lastCanvas.width * lastCanvas.height).toBe(0);
    expect(tasks.every(task => task.cancel.mock.calls.length === 1)).toBe(true);
    expect(proxy.cleanup).toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    pdf.getPage.mockImplementation(original);
    pdf.numPages = 3;
  }
});
