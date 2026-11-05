// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ReorderItem, ReorderProvider } from "./ReorderItem";

it("shares native drags between views, rejects other groups, and supports keyboard moves", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const move=vi.fn().mockResolvedValue(true);
  const drag = (type:string, node:Element, y=0) => {
    const event = new MouseEvent(type,{bubbles:true,cancelable:true,clientY:y});
    Object.defineProperty(event,"dataTransfer",{value:{setData:vi.fn(),effectAllowed:"",dropEffect:""}});
    node.dispatchEvent(event);
  };
  try {
    await act(async () => root.render(<ReorderProvider>{["a","b","other"].map(id => <ReorderItem key={id} id={id} label={id} group={id==="other"?"other":"tabs"} ids={["a","b"]} onMove={move}><button>{id}</button></ReorderItem>)}</ReorderProvider>));
    const [a,b,other] = host.querySelectorAll(".reorder-item");
    await act(async()=>drag("dragstart",a));
    await act(async()=>drag("drop",other));
    expect(move).not.toHaveBeenCalled();
    // Native drag initiation can cancel a pointer over a different handle.
    await act(async()=>b.querySelector(".reorder-handle")!.dispatchEvent(new Event("pointercancel",{bubbles:true})));
    await act(async()=>drag("dragover",b,10));
    expect(b.getAttribute("data-drop-edge")).toBe("after");
    await act(async()=>drag("drop",b,10));
    expect(move).toHaveBeenLastCalledWith("a","b",true);
    await act(async()=>b.querySelector(".reorder-handle")!.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowUp",bubbles:true})));
    expect(move).toHaveBeenLastCalledWith("b","a",false);
    await act(async()=>drag("dragstart",a));
    await act(async()=>drag("dragend",a));
    expect(host.querySelector('[data-dragging="true"]')).toBeNull();
  } finally {await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
