/**
 * @vitest-environment jsdom
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseDocumentPrefs } from "./documentPrefs";
import { BackendSettingsDialog } from "./BackendSettingsDialog";

const bridge = vi.hoisted(() => ({
  store: {
    backends: [],
    enabledBridgeIds: [],
  },
  lastSelectedBridgeId: null,
  sameOriginAvailable: true,
  addBackend: vi.fn(),
  deleteBackend: vi.fn(),
  probeBackend: vi.fn(),
  setBridgeEnabled: vi.fn(),
  updateBackend: vi.fn(),
}));

vi.mock("./bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bridge")>();
  return {
    ...actual,
    useBridge: () => bridge,
  };
});

const roots: Root[] = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount();
    }
  });
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("BackendSettingsDialog terminal accessibility", () => {
  it("offers Setup and the startup path for the selected server", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async url => new Response(JSON.stringify(String(url).endsWith("/clis") ? { clis: [
      { id: "claude", installed: false, version: null, operation: null, error: null },
      { id: "codex", installed: true, version: "1.2.3", operation: null, error: null },
      { id: "agy", installed: false, version: null, operation: null, error: null },
    ] } : {
      startup_path: "~/work", projects: [
        { id: "danus", path: "~/work/danus", status: "missing" },
        { id: "pharos", path: "~/work/pharos", status: "installed" },
      ],
    })));
    try {
      const { container } = await render(<BackendSettingsDialog {...settingsProps()}
        serverHttpUrl={path => `https://research.test${path}`} serverLabel="Research server" />);
      const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
      await act(async () => tabs.find(tab => tab.textContent?.includes("Setup"))!.click());
      expect(container.textContent).toContain("Install Danus");
      expect(container.textContent).toContain("Update Codex");
      expect(container.textContent).toContain("Install Claude Code");
      expect(container.textContent).toContain("Research server");
      await act(async () => tabs.find(tab => tab.textContent?.includes("Terminal"))!.click());
      const input = container.querySelector<HTMLInputElement>('.settings-path-input')!;
      expect(input.value).toBe("~/work");
      expect(input.disabled).toBe(false);
    } finally { fetch.mockRestore(); }
  });
  it("offers mobile refocus independently of expanding input", async () => {
    const onFocusChange = vi.fn();
    const { container } = await render(
      <BackendSettingsDialog {...settingsProps()} showMobileTerminalSettings={true}
        mobileCommandExpandingInput={false} onMobileCommandFocusAfterSubmit={onFocusChange} />,
    );
    const tab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((button) => button.textContent?.includes("Mobile"));
    expect(tab).toBeDefined();
    await act(async () => tab!.click());
    const group = requiredElement<HTMLElement>(container,
      '[role="group"][aria-label="Focus command input after Send"]');
    const [off, on] = Array.from(group.querySelectorAll<HTMLButtonElement>("button"));
    expect(off.getAttribute("aria-pressed")).toBe("true");
    await act(async () => on.click());
    expect(onFocusChange).toHaveBeenCalledWith(true);
  });

  it("exposes a persisted-style opt-in control in the Terminal area", async () => {
    const onChange = vi.fn();
    const { container } = await render(<SettingsHarness onChange={onChange} />);
    const terminalTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((button) => button.textContent?.includes("Terminal"));
    if (!terminalTab) {
      throw new Error("missing Terminal settings tab");
    }

    await act(async () => terminalTab.click());
    const group = requiredElement<HTMLElement>(
      container,
      '[role="group"][aria-label="Terminal screen-reader text"]',
    );
    const [off, on] = Array.from(group.querySelectorAll<HTMLButtonElement>("button"));
    expect(off?.getAttribute("aria-pressed")).toBe("true");
    expect(on?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => on?.click());
    expect(onChange).toHaveBeenCalledWith(true);
    expect(off?.getAttribute("aria-pressed")).toBe("false");
    expect(on?.getAttribute("aria-pressed")).toBe("true");
  });

  it("allows automatic conflict renaming to be disabled in the Terminal area", async () => {
    const onChange = vi.fn();
    const { container } = await render(<UploadSettingsHarness onChange={onChange} />);
    const terminalTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((button) => button.textContent?.includes("Terminal"));
    if (!terminalTab) {
      throw new Error("missing Terminal settings tab");
    }

    await act(async () => terminalTab.click());
    const group = requiredElement<HTMLElement>(
      container,
      '[role="group"][aria-label="Automatically rename conflicting uploads"]',
    );
    const [off, on] = Array.from(group.querySelectorAll<HTMLButtonElement>("button"));
    expect(off?.getAttribute("aria-pressed")).toBe("false");
    expect(on?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => off?.click());
    expect(onChange).toHaveBeenCalledWith(false);
    expect(off?.getAttribute("aria-pressed")).toBe("true");
    expect(on?.getAttribute("aria-pressed")).toBe("false");
  });

  it("offers desktop command composer settings in the Terminal area", async () => {
    const onComposerChange = vi.fn();
    const onEnterNewlineChange = vi.fn();
    const { container } = await render(
      <ComposerSettingsHarness
        onComposerChange={onComposerChange}
        onEnterNewlineChange={onEnterNewlineChange}
      />,
    );
    const terminalTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((button) => button.textContent?.includes("Terminal"));
    if (!terminalTab) {
      throw new Error("missing Terminal settings tab");
    }

    await act(async () => terminalTab.click());
    const composerGroup = requiredElement<HTMLElement>(
      container,
      '[role="group"][aria-label="Command composer"]',
    );
    const [composerOff, composerOn] = Array.from(
      composerGroup.querySelectorAll<HTMLButtonElement>("button"),
    );
    expect(composerOff?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => composerOn?.click());
    expect(onComposerChange).toHaveBeenCalledWith(true);
    expect(composerOn?.getAttribute("aria-pressed")).toBe("true");

    const newlineGroup = requiredElement<HTMLElement>(
      container,
      '[role="group"][aria-label="Desktop composer Enter inserts newline"]',
    );
    const [newlineOff, newlineOn] = Array.from(
      newlineGroup.querySelectorAll<HTMLButtonElement>("button"),
    );
    expect(newlineOn?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => newlineOff?.click());
    expect(onEnterNewlineChange).toHaveBeenCalledWith(false);
    expect(newlineOff?.getAttribute("aria-pressed")).toBe("true");
  });

  it("allows cursor blinking to be enabled in the Terminal area", async () => {
    const onChange = vi.fn();
    const { container } = await render(<CursorBlinkSettingsHarness onChange={onChange} />);
    const terminalTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((button) => button.textContent?.includes("Terminal"));
    if (!terminalTab) {
      throw new Error("missing Terminal settings tab");
    }

    await act(async () => terminalTab.click());
    const group = requiredElement<HTMLElement>(
      container,
      '[role="group"][aria-label="Terminal cursor blink"]',
    );
    const [off, on] = Array.from(group.querySelectorAll<HTMLButtonElement>("button"));
    expect(off?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => on?.click());
    expect(onChange).toHaveBeenCalledWith(true);
    expect(on?.getAttribute("aria-pressed")).toBe("true");
  });
});

function CursorBlinkSettingsHarness({ onChange }: { onChange: (enabled: boolean) => void }) {
  const [terminalCursorBlink, setTerminalCursorBlink] = useState(false);
  return (
    <BackendSettingsDialog
      {...settingsProps()}
      showMobileTerminalSettings={false}
      terminalCursorBlink={terminalCursorBlink}
      onTerminalCursorBlink={(enabled) => {
        onChange(enabled);
        setTerminalCursorBlink(enabled);
      }}
    />
  );
}

function SettingsHarness({ onChange }: { onChange: (enabled: boolean) => void }) {
  const [terminalScreenReaderText, setTerminalScreenReaderText] = useState(false);
  return (
    <BackendSettingsDialog
      {...settingsProps()}
      terminalScreenReaderText={terminalScreenReaderText}
      onTerminalScreenReaderText={(enabled) => {
        onChange(enabled);
        setTerminalScreenReaderText(enabled);
      }}
    />
  );
}

function UploadSettingsHarness({ onChange }: { onChange: (enabled: boolean) => void }) {
  const [autoRenameUploadConflicts, setAutoRenameUploadConflicts] = useState(true);
  return (
    <BackendSettingsDialog
      {...settingsProps()}
      autoRenameUploadConflicts={autoRenameUploadConflicts}
      onAutoRenameUploadConflicts={(enabled) => {
        onChange(enabled);
        setAutoRenameUploadConflicts(enabled);
      }}
    />
  );
}

function ComposerSettingsHarness({
  onComposerChange,
  onEnterNewlineChange,
}: {
  onComposerChange: (enabled: boolean) => void;
  onEnterNewlineChange: (enabled: boolean) => void;
}) {
  const [desktopCommandComposer, setDesktopCommandComposer] = useState(false);
  const [desktopCommandEnterNewline, setDesktopCommandEnterNewline] = useState(true);
  return (
    <BackendSettingsDialog
      {...settingsProps()}
      showMobileTerminalSettings={false}
      desktopCommandComposer={desktopCommandComposer}
      onDesktopCommandComposer={(enabled) => {
        onComposerChange(enabled);
        setDesktopCommandComposer(enabled);
      }}
      desktopCommandEnterNewline={desktopCommandEnterNewline}
      onDesktopCommandEnterNewline={(enabled) => {
        onEnterNewlineChange(enabled);
        setDesktopCommandEnterNewline(enabled);
      }}
    />
  );
}

function settingsProps() {
  return {
    defaultView: "conversation" as const,
    onDefaultView: vi.fn(),
    showMobileTerminalSettings: true,
    notesEnabled: true,
    onNotesEnabled: vi.fn(),
    navigationSyncMode: "shared" as const,
    onNavigationSyncMode: vi.fn(),
    agentFeaturesInTabs: true,
    onAgentFeaturesInTabs: vi.fn(),
    combineMatchingWorkspaceNames: false,
    onCombineMatchingWorkspaceNames: vi.fn(),
    multiHostSpaceSelection: true,
    onMultiHostSpaceSelection: vi.fn(),
    terminalScrollSpeed: 100,
    onTerminalScrollSpeed: vi.fn(),
    terminalFontSizePx: 13,
    onTerminalFontSizePx: vi.fn(),
    terminalCursorBlink: false,
    onTerminalCursorBlink: vi.fn(),
    desktopCommandComposer: false,
    onDesktopCommandComposer: vi.fn(),
    desktopCommandEnterNewline: true,
    onDesktopCommandEnterNewline: vi.fn(),
    terminalScreenReaderText: false,
    onTerminalScreenReaderText: vi.fn(),
    autoRenameUploadConflicts: true,
    onAutoRenameUploadConflicts: vi.fn(),
    terminalInputTransport: "json" as const,
    onTerminalInputTransport: vi.fn(),
    terminalInputBatchDelayMs: 0,
    onTerminalInputBatchDelayMs: vi.fn(),
    terminalOutputCoalesceMs: 16,
    onTerminalOutputCoalesceMs: vi.fn(),
    contentInsetTopPx: 0,
    onContentInsetTopPx: vi.fn(),
    contentInsetBottomPx: 0,
    onContentInsetBottomPx: vi.fn(),
    mobileControlsScalePercent: 100,
    onMobileControlsScalePercent: vi.fn(),
    mobileTerminalTapTarget: "command-input" as const,
    onMobileTerminalTapTarget: vi.fn(),
    mobileLongPressBehavior: "off" as const,
    onMobileLongPressBehavior: vi.fn(),
    mobileTouchSelectionEndpointTimeoutMs: 1500 as const,
    onMobileTouchSelectionEndpointTimeoutMs: vi.fn(),
    mobileCommandExpandingInput: true,
    onMobileCommandExpandingInput: vi.fn(),
    mobileCommandEnterNewline: false,
    mobileCommandFocusAfterSubmit: false,
    onMobileCommandFocusAfterSubmit: vi.fn(),
    onMobileCommandEnterNewline: vi.fn(),
    onClose: vi.fn(),
  };
}

async function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(node));
  return { container, root };
}

function requiredElement<T extends Element = HTMLElement>(
  container: ParentNode,
  selector: string,
) {
  const element = container.querySelector<T>(selector);
  if (!element) {
    throw new Error(`missing element: ${selector}`);
  }
  return element;
}


it("exposes document defaults, persists changes and offers layout reset", async () => {
  localStorage.clear();
  const reset = vi.fn();
  const { container } = await render(<BackendSettingsDialog {...settingsProps()} onResetPanelLayout={reset} />);
  const tab = (name: string) => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent === name)!;
  expect(tab("Connections")).toBeTruthy();
  expect(container.textContent).toContain("This server");
  await act(async () => tab("Documents").click());
  const fit = requiredElement<HTMLSelectElement>(container, '[aria-label="PDF opening size"]');
  expect(fit.value).toBe("width");
  await act(async () => { fit.value = "page"; fit.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(parseDocumentPrefs(localStorage.getItem("herdr-document-preferences")).pdfFit).toBe("page");
  for (const label of ["Remember reading position", "Remember expanded folders"]) {
    const group = requiredElement(container, `[role="group"][aria-label="${label}"]`);
    const buttons = group.querySelectorAll<HTMLButtonElement>("button");
    expect([...buttons].map(button => button.textContent)).toEqual(["Off", "On"]);
    expect(buttons[1].getAttribute("aria-pressed")).toBe("true");
    await act(async () => buttons[0].click());
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
  }
  const preferences = parseDocumentPrefs(localStorage.getItem("herdr-document-preferences"));
  expect(preferences.rememberPosition).toBe(false);
  expect(preferences.rememberFolders).toBe(false);
  await act(async () => tab("Display").click());
  const resetButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === "Reset panel layout")!;
  await act(async () => resetButton.click());
  expect(reset).toHaveBeenCalledOnce();
  await act(async () => tab("Terminal").click());
  expect(requiredElement<HTMLDetailsElement>(container, 'details').open).toBe(false);
  expect(requiredElement(container, 'details').textContent).toContain("Input batching");
  localStorage.clear();
});

it("offers all three opening modes in Display settings", async () => {
  const onDefaultView = vi.fn();
  const { container } = await render(
    <BackendSettingsDialog {...settingsProps()} defaultView="remember" onDefaultView={onDefaultView} />,
  );
  const tab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    .find(button => button.textContent?.includes("Display"));
  await act(async () => tab!.click());
  const select = requiredElement<HTMLSelectElement>(container, 'select[aria-label="Default view"]');
  expect(select.value).toBe("remember");
  expect(Array.from(select.options, option => option.text)).toEqual([
    "Conversation", "Terminal", "Remember last used",
  ]);
  for (const value of ["terminal", "conversation", "remember"]) {
    await act(async () => {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onDefaultView).toHaveBeenLastCalledWith(value);
  }
});

it("exposes terminal scrolling speed and resets it to 100 percent", async () => {
  const onTerminalScrollSpeed = vi.fn();
  const { container } = await render(
    <BackendSettingsDialog {...settingsProps()} terminalScrollSpeed={175}
      onTerminalScrollSpeed={onTerminalScrollSpeed} />,
  );
  const tab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    .find(button => button.textContent?.includes("Terminal"));
  await act(async () => tab!.click());
  const input = requiredElement<HTMLInputElement>(container, 'input[aria-label="Scrolling speed"]');
  expect(input.value).toBe("175");
  expect(input.min).toBe("50");
  expect(input.max).toBe("300");
  const reset = requiredElement<HTMLButtonElement>(container, 'button[aria-label="Reset scrolling speed"]');
  await act(async () => reset.click());
  expect(onTerminalScrollSpeed).toHaveBeenCalledWith(100);
});

it("offers ten presets and keeps reading settings when choosing TIG", async () => {
  localStorage.removeItem("herdr-appearance-preferences");
  const { container } = await render(<BackendSettingsDialog {...settingsProps()} />);
  const tab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(button => button.textContent?.includes("Appearance"));
  await act(async () => tab!.click());
  const cards = Array.from(container.querySelectorAll<HTMLButtonElement>('.appearance-theme-card'));
  expect(cards).toHaveLength(10);
  const font = requiredElement<HTMLSelectElement>(container, '[aria-label="Conversation font"]');
  await act(async () => { font.value = "serif"; font.dispatchEvent(new Event("change", { bubbles: true })); });
  const tig = cards.find(button => button.textContent?.includes("TIG"))!;
  await act(async () => tig.click());
  expect(tig.getAttribute("aria-pressed")).toBe("true");
  expect(JSON.parse(localStorage.getItem("herdr-appearance-preferences")!)).toMatchObject({ theme: "tig", readingFont: "serif", followSystem: false });
  localStorage.removeItem("herdr-appearance-preferences");
});
it("resets appearance and the existing terminal size preference together", async () => {
  localStorage.setItem("herdr-appearance-preferences", JSON.stringify({ theme: "tig", reducedMotion: true }));
  const onFont = vi.fn();
  const { container } = await render(<BackendSettingsDialog {...settingsProps()} terminalFontSizePx={20} onTerminalFontSizePx={onFont} />);
  const tab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(button => button.textContent?.includes("Appearance"));
  await act(async () => tab!.click());
  const reset = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === "Reset appearance")!;
  await act(async () => reset.click());
  expect(onFont).toHaveBeenCalledWith(13);
  expect(JSON.parse(localStorage.getItem("herdr-appearance-preferences")!)).toMatchObject({ theme: "dark", reducedMotion: false });
  localStorage.removeItem("herdr-appearance-preferences");
});
