// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PanelLayoutControl } from "./PanelLayoutControl";
import type { PanelLayout } from "./PanelLayoutControl";

it("offers the corrected three layouts and identifies the active choice", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  function Harness() {
    const [value, setValue] = useState<PanelLayout>("files-session");
    return <PanelLayoutControl value={value} onChange={setValue} />;
  }
  try {
    await act(async () => root.render(<Harness />));
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.map(b => b.getAttribute("aria-label"))).toEqual([
      "Files and conversation", "Files and document", "Files, conversation and document",
    ]);
    for (const button of buttons) {
      await act(async () => button.click());
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
    }
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
