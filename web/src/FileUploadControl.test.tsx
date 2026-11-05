// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { FileUploadControl, MAX_DANUS_UPLOAD, uploadFileError } from "./FileUploadControl";

it("accepts only the requested types and at most 100 MB per file", () => {
  for (const name of ["a.pdf", "a.TEX", "a.md", "a.MD", "a.txt", "a.djvu", "a.bib", "a.lean", "a.csv", "a.json", "a.png", "a.JPG", "a.jpeg", "a.py", "a.sage", "a.ipynb", "a.sty", "a.cls"]) expect(uploadFileError({ name, size: MAX_DANUS_UPLOAD })).toBeNull();
  for (const file of [{ name: "a.pdf", size: MAX_DANUS_UPLOAD + 1 }, { name: "a.exe", size: 5 }, { name: "a.txt", size: 0 }]) expect(uploadFileError(file)).toBeTruthy();
});

it.each(["pdf", "md", "png", "lean", "ipynb"])("uploads dropped %s files to the fixed inbox and reports renamed paths", async extension => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const posted: { url: string; options: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit = {}) => {
    if (url.endsWith("upload-info")) return new Response(JSON.stringify({ enabled: true }));
    posted.push({ url, options });
    return new Response(JSON.stringify({ path: `uploads/paper-1.${extension}`, destination: `~/work/uploads/paper-1.${extension}` }), { status: 201 });
  }));
  const element = document.createElement("div"); document.body.append(element);
  const root = createRoot(element); const uploaded = vi.fn();
  try {
    await act(async () => root.render(<FileUploadControl onUploaded={uploaded}>{c => <section {...c.dropProps}>{c.input}{c.button}{c.status}</section>}</FileUploadControl>));
    const file = new File([extension === "pdf" ? "%PDF-1.7\n" : "# Notes\n"], `paper.${extension}`);
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { types: ["Files"], files: [file] } });
    await act(async () => element.querySelector("section")!.dispatchEvent(drop));
    expect(drop.defaultPrevented).toBe(true);
    expect(posted).toHaveLength(1);
    expect(posted[0].url).toBe(`/api/project-files/upload?name=paper.${extension}`);
    expect(posted[0].options.body).toBe(file);
    expect(posted[0].options.headers).toEqual({ "Content-Type": "application/octet-stream", "X-Herdr-Upload": "1" });
    expect(uploaded).toHaveBeenCalledWith(`uploads/paper-1.${extension}`);
    expect(element.textContent).toContain("Uploaded 1 file");
    const input = element.querySelector("input")!;
    expect(input.accept.split(",")).toEqual(expect.arrayContaining([".md", ".bib", ".lean", ".csv", ".json", ".png", ".jpg", ".jpeg", ".py", ".sage", ".ipynb", ".sty", ".cls"]));
    Object.defineProperty(input, "files", { value: [new File(["x"], "bad.exe")] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(posted).toHaveLength(1);
    expect(element.querySelector('[role="alert"]')?.textContent).toContain("Supported files:");
  } finally { await act(async () => root.unmount()); element.remove(); vi.unstubAllGlobals(); }
});
