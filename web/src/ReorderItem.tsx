import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode, PointerEvent } from "react";
import { GripVertical } from "lucide-react";

type Move = (source: string, target: string, after: boolean) => Promise<unknown>;
type Drag = { id: string; group: string; move: Move };
type Target = { id: string; group: string; after: boolean };
const Context = createContext<{
  drag: Drag | null; target: Target | null; busy: boolean;
  current: () => Drag | null;
  start: (drag: Drag | null) => void; aim: (target: Target | null) => void;
  finish: (target: Target | null) => void;
  run: (drag: Drag, target: Target) => void;
} | null>(null);

export function ReorderProvider({ children }: { children: ReactNode }) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const start = (next: Drag | null) => { dragRef.current = next; setDrag(next); };
  const [target, aim] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState("");
  const run = (source: Drag, destination: Target) => {
    if (busyRef.current || source.group !== destination.group || source.id === destination.id) return;
    busyRef.current = true; setBusy(true);
    void Promise.resolve().then(() => source.move(source.id, destination.id, destination.after))
      .then(moved => setNotice(moved === false ? "Order unchanged." : "Order updated."))
      .catch(() => setNotice("Could not change order. Try again."))
      .finally(() => { busyRef.current = false; setBusy(false); });
  };
  const finish = (destination: Target | null) => {
    const drag = dragRef.current;
    start(null); aim(null);
    if (!drag || !destination || drag.group !== destination.group || drag.id === destination.id) return;
    run(drag, destination);
  };
  return <Context.Provider value={{ drag, target, busy, current: () => dragRef.current, start, aim, finish, run }}>{children}<span className="sr-only" role="status">{notice}</span></Context.Provider>;
}

export function ReorderItem({ id, group, label, ids, horizontal = false, enabled = true, showHandle = true, onMove, children }: {
  id: string; group: string; label: string; ids: string[]; horizontal?: boolean;
  enabled?: boolean; showHandle?: boolean; onMove: Move; children: ReactNode;
}) {
  const context = useContext(Context);
  const rowRef = useRef<HTMLDivElement>(null);
  const touchClickUntil = useRef(0);
  const live = useRef({context, enabled, group, id, onMove});
  live.current = {context, enabled, group, id, onMove};
  useEffect(() => {
    const row = rowRef.current;
    if (!row || showHandle) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let origin: {x:number;y:number} | null = null;
    let armed = false;
    let moved = false;
    let pressed: EventTarget | null = null;
    const target = (x:number,y:number): Target | null => {
      const node = document.elementsFromPoint(x,y).map(el=>el.closest<HTMLElement>('[data-reorder-id]')).find(el=>el && el.dataset.reorderGroup === live.current.group && el.dataset.reorderId !== live.current.id);
      if (!node) return null;
      const rect=node.getBoundingClientRect();
      return {id:node.dataset.reorderId!,group:live.current.group,after:node.dataset.reorderAxis==='x'?x>rect.left+rect.width/2:y>rect.top+rect.height/2};
    };
    const start = (event:TouchEvent) => {
      if (!live.current.enabled || live.current.context?.busy || event.touches.length!==1) return;
      const touch=event.touches[0];origin={x:touch.clientX,y:touch.clientY};
      pressed=event.target; moved=false;
      timer=setTimeout(()=>{armed=true;},300);
    };
    const move = (event:TouchEvent) => {
      const touch=event.touches[0];if(!origin || !touch)return;
      if(!armed){if(Math.hypot(touch.clientX-origin.x,touch.clientY-origin.y)>8){clearTimeout(timer);origin=null;}return;}
      if(!moved && Math.hypot(touch.clientX-origin.x,touch.clientY-origin.y)<=5)return;
      if(!moved){moved=true;live.current.context?.start({id:live.current.id,group:live.current.group,move:live.current.onMove});
        if(pressed instanceof HTMLElement)pressed.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true}));}
      event.preventDefault();event.stopPropagation();live.current.context?.aim(target(touch.clientX,touch.clientY));
      const scroller=row.closest<HTMLElement>(horizontal?'.tabbar-scroll':'.list');
      if(scroller){const rect=scroller.getBoundingClientRect();if(horizontal)scroller.scrollLeft+=touch.clientX<rect.left+24?-16:touch.clientX>rect.right-24?16:0;else scroller.scrollTop+=touch.clientY<rect.top+24?-16:touch.clientY>rect.bottom-24?16:0;}
    };
    const end = (event:TouchEvent) => {
      clearTimeout(timer);origin=null;
      if(moved){event.preventDefault();event.stopPropagation();touchClickUntil.current=Date.now()+500;
        const touch=event.changedTouches[0];live.current.context?.finish(event.type==='touchend' && touch?target(touch.clientX,touch.clientY):null);}
      armed=false;moved=false;
    };
    row.addEventListener('touchstart',start,{passive:true});row.addEventListener('touchmove',move,{passive:false});
    row.addEventListener('touchend',end,{passive:false});row.addEventListener('touchcancel',end,{passive:false});
    return()=>{clearTimeout(timer);if(moved)live.current.context?.finish(null);row.removeEventListener('touchstart',start);row.removeEventListener('touchmove',move);row.removeEventListener('touchend',end);row.removeEventListener('touchcancel',end);};
  },[showHandle,horizontal]);
  const pointer = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const usable = enabled && !!context && !context.busy && ids.length > 1;
  const target = context?.target;
  const marked = target?.id === id && target.group === group;
  const targetAt = (node: HTMLElement, x: number, y: number): Target => {
    const rect = node.getBoundingClientRect();
    return { id: node.dataset.reorderId!, group: node.dataset.reorderGroup!,
      after: node.dataset.reorderAxis === "x" ? x > rect.left + rect.width / 2 : y > rect.top + rect.height / 2 };
  };
  const pointerTarget = (event: PointerEvent): Target | null => {
    const node = document.elementsFromPoint(event.clientX, event.clientY)
      .map(el => el.closest<HTMLElement>("[data-reorder-id]"))
      .find(el => el && el.dataset.reorderGroup === group && el.dataset.reorderId !== id);
    return node ? targetAt(node, event.clientX, event.clientY) : null;
  };
  return <div ref={rowRef} className="reorder-item" data-handle={showHandle ? "visible" : "hidden"}
    onClickCapture={event=>{if(Date.now()<touchClickUntil.current){event.preventDefault();event.stopPropagation();}}} data-reorder-axis={horizontal ? "x" : "y"}
    data-reorder-id={enabled ? id : undefined} data-reorder-group={group}
    data-drop-edge={marked ? target.after ? "after" : "before" : undefined}
    data-dragging={context?.drag?.id === id && context.drag.group === group || undefined}
    draggable={usable}
    onDragStart={event => {
      if (!usable) { event.preventDefault(); return; }
      event.stopPropagation();
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-passel-reorder", id);
      context!.start({ id, group, move: onMove });
    }}
    onDragOver={event => {
      if (!enabled || context?.current()?.group !== group || context.current()?.id === id) return;
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move";
      context.aim(targetAt(event.currentTarget, event.clientX, event.clientY));
      // Keep long lists reachable without scrolling the entire page.
      const scroller = event.currentTarget.closest<HTMLElement>(horizontal ? ".tabbar-scroll" : ".list");
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        if (horizontal) scroller.scrollLeft += event.clientX < r.left + 24 ? -16 : event.clientX > r.right - 24 ? 16 : 0;
        else scroller.scrollTop += event.clientY < r.top + 24 ? -16 : event.clientY > r.bottom - 24 ? 16 : 0;
      }
    }}
    onDrop={event => {
      if (context?.current()?.group !== group) return;
      event.preventDefault(); event.stopPropagation(); context.finish(targetAt(event.currentTarget, event.clientX, event.clientY));
    }}
    onDragEnd={() => { context?.start(null); context?.aim(null); }}>
    {children}
    {enabled && context && ids.length > 1 && <button type="button" className={showHandle ? "reorder-handle" : "reorder-keyboard-only"} aria-disabled={context.busy} aria-label={`Reorder ${label}`}
      title="Drag to reorder within this priority group, or use arrow keys"
      onClick={event => { event.preventDefault(); event.stopPropagation(); }}
      onPointerDown={event => {
        if (event.button !== 0 || !usable) return;
        event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
        pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
        context!.start({ id, group, move: onMove });
      }}
      onPointerMove={event => {
        const p = pointer.current;
        if (!p || p.id !== event.pointerId) return;
        p.moved ||= Math.hypot(event.clientX - p.x, event.clientY - p.y) > 5;
        if (p.moved) {
          context!.aim(pointerTarget(event));
          const scroller = document.elementsFromPoint(event.clientX, event.clientY)
            .map(el => el.closest<HTMLElement>(horizontal ? ".tabbar-scroll" : ".list")).find(Boolean);
          if (scroller) {
            const r = scroller.getBoundingClientRect();
            if (horizontal) scroller.scrollLeft += event.clientX < r.left + 24 ? -16 : event.clientX > r.right - 24 ? 16 : 0;
            else scroller.scrollTop += event.clientY < r.top + 24 ? -16 : event.clientY > r.bottom - 24 ? 16 : 0;
          }
        }
      }}
      onPointerUp={event => {
        const p = pointer.current; pointer.current = null;
        if (p?.id === event.pointerId) context!.finish(p.moved ? pointerTarget(event) : null);
      }}
      onPointerCancel={() => { if (pointer.current) { pointer.current = null; context!.finish(null); } }}
      onKeyDown={event => {
        if (!usable) return;
        if (event.key === "Escape") { pointer.current = null; context!.finish(null); return; }
        const step = event.key === (horizontal ? "ArrowLeft" : "ArrowUp") ? -1 : event.key === (horizontal ? "ArrowRight" : "ArrowDown") ? 1 : 0;
        if (!step) return;
        event.preventDefault(); event.stopPropagation();
        const target = ids[ids.indexOf(id) + step];
        if (target) context!.run({ id, group, move: onMove }, { id: target, group, after: step > 0 });
      }}>{showHandle ? <GripVertical size={12} /> : "Move"}</button>}
  </div>;
}
