import { DEFAULT_APPEARANCE, effectiveTheme, useAppearancePrefs, useSystemDark, updateAppearancePrefs } from "./appearancePrefs";
import { APPEARANCE_THEMES, READING_FONTS, TERMINAL_FONTS } from "./appearanceThemes";
import type { ReadingFont, TerminalFont } from "./appearanceThemes";
import { parseTerminalScrollSpeed } from "./terminalScrolling";
import { useDocumentPrefs, updateDocumentPrefs } from "./documentPrefs";
import { hexToHsva, hsvaToHex } from "@uiw/color-convert";
import type { HsvaColor } from "@uiw/color-convert";
import Wheel from "@uiw/react-color-wheel";
import {
  Palette,
  Plus,
  RotateCcw,
  Server,
  SlidersHorizontal,
  Smartphone,
  SquareTerminal,
  StickyNote,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import type { BridgeHttpUrl } from "./bridgeApi";
import { AgentCliSetupPanel, ProjectSetupPanel, TerminalStartupSetting } from "./ServerSetupSettings";
import {
  duplicateBackend,
  fallbackBackendColor,
  normalizeBridgeBaseUrl,
  normalizeBackendColor,
  SAME_ORIGIN_BRIDGE_ID,
  SAME_ORIGIN_BRIDGE_COLOR,
  suggestBackendColor,
  useBridge,
} from "./bridge";
import type { BridgeBackendProfile } from "./bridge";
import {
  DEFAULT_CONTENT_INSET_BOTTOM_PX,
  DEFAULT_CONTENT_INSET_TOP_PX,
  DEFAULT_MOBILE_CONTROLS_SCALE_PERCENT,
  MAX_CONTENT_INSET_BOTTOM_PX,
  MAX_CONTENT_INSET_TOP_PX,
  MAX_MOBILE_CONTROLS_SCALE_PERCENT,
  MIN_CONTENT_INSET_BOTTOM_PX,
  MIN_CONTENT_INSET_TOP_PX,
  MIN_MOBILE_CONTROLS_SCALE_PERCENT,
  type DefaultView,
  parseDefaultView,
  parseContentInsetBottomPx,
  parseContentInsetTopPx,
  parseMobileControlsScalePercent,
} from "./displayPrefs";
import {
  DEFAULT_TERMINAL_FONT_SIZE_PX,
  MAX_TERMINAL_FONT_SIZE_PX,
  MIN_TERMINAL_FONT_SIZE_PX,
  parseTerminalFontSizePx,
} from "./terminalPrefs";
import {
  MOBILE_TOUCH_SELECTION_ENDPOINT_TIMEOUT_OPTIONS_MS,
} from "./mobileTerminalPrefs";
import type {
  MobileLongPressBehavior,
  MobileTerminalTapTarget,
  MobileTouchSelectionEndpointTimeoutMs,
} from "./mobileTerminalPrefs";
import type { NavigationSyncMode } from "./navigationPrefs";
import { trapFocusWithin, useFocusReturn } from "./overlayFocus";
import { TERMINAL_INPUT_BATCH_DELAY_OPTIONS_MS } from "./terminalInputTransport";
import type { TerminalInputTransport } from "./terminalInputTransport";
import { TERMINAL_OUTPUT_COALESCE_OPTIONS_MS } from "./terminalOutputCoalescing";

type Props = {
  serverHttpUrl?: BridgeHttpUrl;
  serverLabel?: string;
  serverKey?: string;
  defaultView: DefaultView;
  onDefaultView: (value: DefaultView) => void;
  showMobileTerminalSettings: boolean;
  notesEnabled: boolean;
  onNotesEnabled: (enabled: boolean) => void;
  navigationSyncMode: NavigationSyncMode;
  onNavigationSyncMode: (mode: NavigationSyncMode) => void;
  agentFeaturesInTabs: boolean;
  onAgentFeaturesInTabs: (enabled: boolean) => void;
  combineMatchingWorkspaceNames: boolean;
  onCombineMatchingWorkspaceNames: (enabled: boolean) => void;
  multiHostSpaceSelection: boolean;
  onMultiHostSpaceSelection: (enabled: boolean) => void;
  terminalScrollSpeed: number;
  onTerminalScrollSpeed: (value: number) => void;
  terminalFontSizePx: number;
  onTerminalFontSizePx: (value: number) => void;
  terminalCursorBlink: boolean;
  onTerminalCursorBlink: (enabled: boolean) => void;
  desktopCommandComposer: boolean;
  onDesktopCommandComposer: (enabled: boolean) => void;
  desktopCommandEnterNewline: boolean;
  onDesktopCommandEnterNewline: (enabled: boolean) => void;
  terminalScreenReaderText: boolean;
  onTerminalScreenReaderText: (enabled: boolean) => void;
  autoRenameUploadConflicts: boolean;
  onAutoRenameUploadConflicts: (enabled: boolean) => void;
  terminalInputTransport: TerminalInputTransport;
  onTerminalInputTransport: (transport: TerminalInputTransport) => void;
  terminalInputBatchDelayMs: number;
  onTerminalInputBatchDelayMs: (delayMs: number) => void;
  terminalOutputCoalesceMs: number;
  onTerminalOutputCoalesceMs: (delayMs: number) => void;
  contentInsetTopPx: number;
  onContentInsetTopPx: (value: number) => void;
  contentInsetBottomPx: number;
  onContentInsetBottomPx: (value: number) => void;
  mobileControlsScalePercent: number;
  onMobileControlsScalePercent: (value: number) => void;
  mobileTerminalTapTarget: MobileTerminalTapTarget;
  onMobileTerminalTapTarget: (target: MobileTerminalTapTarget) => void;
  mobileLongPressBehavior: MobileLongPressBehavior;
  onMobileLongPressBehavior: (behavior: MobileLongPressBehavior) => void;
  mobileTouchSelectionEndpointTimeoutMs: MobileTouchSelectionEndpointTimeoutMs;
  onMobileTouchSelectionEndpointTimeoutMs: (
    timeoutMs: MobileTouchSelectionEndpointTimeoutMs,
  ) => void;
  mobileCommandExpandingInput: boolean;
  onMobileCommandExpandingInput: (enabled: boolean) => void;
  mobileCommandEnterNewline: boolean;
  mobileCommandFocusAfterSubmit: boolean;
  onMobileCommandEnterNewline: (enabled: boolean) => void;
  onMobileCommandFocusAfterSubmit: (enabled: boolean) => void;
  onResetPanelLayout?: () => void;
  onClose: () => void;
};

type FormState = {
  id: string | null;
  name: string;
  baseUrl: string;
  color: string;
};

type SelectionMode = "same-origin" | "new" | "backend";
type SettingsArea = "bridge" | "setup" | "features" | "display" | "terminal" | "mobile" | "documents" | "appearance";

export function BackendSettingsDialog({
  serverHttpUrl, serverLabel, serverKey,
  defaultView,
  onDefaultView,
  onResetPanelLayout,
  showMobileTerminalSettings,
  notesEnabled,
  onNotesEnabled,
  navigationSyncMode,
  onNavigationSyncMode,
  agentFeaturesInTabs,
  onAgentFeaturesInTabs,
  combineMatchingWorkspaceNames,
  onCombineMatchingWorkspaceNames,
  multiHostSpaceSelection,
  onMultiHostSpaceSelection,
  terminalScrollSpeed,
  onTerminalScrollSpeed,
  terminalFontSizePx,
  onTerminalFontSizePx,
  terminalCursorBlink,
  onTerminalCursorBlink,
  desktopCommandComposer,
  onDesktopCommandComposer,
  desktopCommandEnterNewline,
  onDesktopCommandEnterNewline,
  terminalScreenReaderText,
  onTerminalScreenReaderText,
  autoRenameUploadConflicts,
  onAutoRenameUploadConflicts,
  terminalInputTransport,
  onTerminalInputTransport,
  terminalInputBatchDelayMs,
  onTerminalInputBatchDelayMs,
  terminalOutputCoalesceMs,
  onTerminalOutputCoalesceMs,
  contentInsetTopPx,
  onContentInsetTopPx,
  contentInsetBottomPx,
  onContentInsetBottomPx,
  mobileControlsScalePercent,
  onMobileControlsScalePercent,
  mobileTerminalTapTarget,
  onMobileTerminalTapTarget,
  mobileLongPressBehavior,
  onMobileLongPressBehavior,
  mobileTouchSelectionEndpointTimeoutMs,
  onMobileTouchSelectionEndpointTimeoutMs,
  mobileCommandExpandingInput,
  onMobileCommandExpandingInput,
  mobileCommandEnterNewline,
  mobileCommandFocusAfterSubmit,
  onMobileCommandEnterNewline,
  onMobileCommandFocusAfterSubmit,
  onClose,
}: Props) {
  const bridge = useBridge();
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  useFocusReturn();
  const [form, setForm] = useState<FormState>(() => newBackendForm(bridge.store.backends));
  const [selectionMode, setSelectionMode] = useState<SelectionMode>(
    initialSelectionMode(bridge.lastSelectedBridgeId, bridge.sameOriginAvailable),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<BridgeBackendProfile | null>(null);
  const documentPrefs = useDocumentPrefs();
  const [activeArea, setActiveArea] = useState<SettingsArea>("bridge");

  const selectedBackend = useMemo(
    () => bridge.store.backends.find((backend) => backend.id === form.id) ?? null,
    [bridge.store.backends, form.id],
  );
  const sameOriginEnabled = bridge.store.enabledBridgeIds.includes(SAME_ORIGIN_BRIDGE_ID);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (activeArea === "mobile" && !showMobileTerminalSettings) {
      setActiveArea("terminal");
    }
  }, [activeArea, showMobileTerminalSettings]);

  useEffect(() => {
    if (selectionMode !== "backend" || form.id || bridge.store.backends.length === 0) {
      return;
    }
    const lastBackend = bridge.lastSelectedBridgeId
      ? bridge.store.backends.find((backend) => backend.id === bridge.lastSelectedBridgeId)
      : undefined;
    const backend = lastBackend ?? bridge.store.backends[0];
    setForm(backendFormFromProfile(backend));
  }, [bridge.lastSelectedBridgeId, bridge.store.backends, form.id, selectionMode]);

  const selectSameOrigin = () => {
    setSelectionMode("same-origin");
    setForm(newBackendForm(bridge.store.backends));
    setMessage(null);
    setDuplicate(null);
  };

  const startNew = () => {
    setSelectionMode("new");
    setForm(newBackendForm(bridge.store.backends));
    setMessage(null);
    setDuplicate(null);
  };

  const editBackend = (backend: BridgeBackendProfile) => {
    setSelectionMode("backend");
    setForm(backendFormFromProfile(backend));
    setMessage(null);
    setDuplicate(null);
  };

  const validateDuplicate = () => {
    try {
      const found = duplicateBackend(bridge.store.backends, form.baseUrl, form.id ?? undefined);
      setDuplicate(found);
      return found;
    } catch {
      setDuplicate(null);
      return null;
    }
  };

  const testBackend = async () => {
    setBusy(true);
    setMessage(null);
    setDuplicate(null);
    try {
      const baseUrl = normalizeBridgeBaseUrl(form.baseUrl);
      const found = duplicateBackend(bridge.store.backends, baseUrl, form.id ?? undefined);
      setDuplicate(found);
      await bridge.probeBackend(baseUrl);
      setMessage(found ? `Reachable; same URL as ${found.name}.` : "Backend reachable.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Backend test failed");
    } finally {
      setBusy(false);
    }
  };

  const saveBackend = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const baseUrl = normalizeBridgeBaseUrl(form.baseUrl);
      const found = duplicateBackend(bridge.store.backends, baseUrl, form.id ?? undefined);
      if (found) {
        setDuplicate(found);
        setMessage(`This URL is already saved as ${found.name}.`);
        return;
      }
      let probeWarning: string | null = null;
      try {
        await bridge.probeBackend(baseUrl);
      } catch (error) {
        probeWarning = error instanceof Error ? error.message : "Backend could not be reached.";
      }
      const profile = form.id
        ? await bridge.updateBackend(form.id, { name: form.name, baseUrl, color: form.color })
        : await bridge.addBackend({ name: form.name, baseUrl, color: form.color }, false);
      setSelectionMode("backend");
      setForm(backendFormFromProfile(profile));
      setMessage(probeWarning ? `Backend saved. ${probeWarning}` : "Backend saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save backend");
    } finally {
      setBusy(false);
    }
  };

  const deleteBackend = () => {
    if (!form.id) {
      return;
    }
    bridge.deleteBackend(form.id);
    startNew();
  };

  const canDelete = Boolean(form.id);
  const editingBackend = selectionMode !== "same-origin";
  const sameOriginUrl = sameOriginDisplayUrl();
  const showSameOrigin = bridge.sameOriginAvailable;
  const areas: { id: SettingsArea; label: string; icon: typeof Server }[] = [
    { id: "bridge", label: "Connections", icon: Server },
    { id: "setup", label: "Setup", icon: Plus },
    { id: "appearance", label: "Appearance", icon: Palette },
    { id: "features", label: "Features", icon: StickyNote },
    { id: "documents", label: "Documents", icon: StickyNote },
    { id: "display", label: "Display", icon: SlidersHorizontal },
    { id: "terminal", label: "Terminal", icon: SquareTerminal },
    ...(showMobileTerminalSettings
      ? [{ id: "mobile" as const, label: "Mobile", icon: Smartphone }]
      : []),
  ];

  return (
    <div className="overlay-root">
      <button
        className="overlay-scrim"
        type="button"
        tabIndex={-1}
        aria-label="Close settings"
        onClick={onClose}
      />
      <form
        className="modal backend-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          trapFocusWithin(event);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (activeArea !== "bridge" || !editingBackend) {
            return;
          }
          void saveBackend();
        }}
      >
        <button
          className="modal-close icon-btn"
          ref={closeButtonRef}
          type="button"
          aria-label="Close"
          title="Close"
          onClick={onClose}
        >
          <X size={15} />
        </button>
        <div id={titleId} className="modal-title">Settings</div>
        <div className="backend-layout">
          <div className="settings-area-list" role="tablist" aria-label="Settings areas">
            {areas.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className="settings-area-tab"
                type="button"
                role="tab"
                data-active={activeArea === id ? "true" : undefined}
                aria-selected={activeArea === id}
                onClick={() => setActiveArea(id)}
              >
                <Icon size={15} />
                <span>{label}</span>
              </button>
            ))}
          </div>

          <div className="settings-panel" role="tabpanel">
            {activeArea === "setup" ? <div className="settings-setup-sections" key={serverKey}>
              <AgentCliSetupPanel httpUrl={serverHttpUrl} serverLabel={serverLabel} />
              <ProjectSetupPanel httpUrl={serverHttpUrl} serverLabel={serverLabel} />
            </div> : null}
            {activeArea === "bridge" ? (
              <>
                <div className="bridge-settings-grid">
                  <div className="backend-list" role="list" aria-label="Saved bridges">
                    {showSameOrigin ? (
                      <BackendToggleRow
                        active={selectionMode === "same-origin"}
                        color={SAME_ORIGIN_BRIDGE_COLOR}
                        enabled={sameOriginEnabled}
                        title="This server"
                        subtitle={sameOriginUrl}
                        toggleLabel={`${sameOriginEnabled ? "Disable" : "Enable"} This server`}
                        onSelect={selectSameOrigin}
                        onToggle={() => bridge.setBridgeEnabled(SAME_ORIGIN_BRIDGE_ID, !sameOriginEnabled)}
                      />
                    ) : null}
                    {bridge.store.backends.map((backend) => {
                      const enabled = bridge.store.enabledBridgeIds.includes(backend.id);
                      return (
                        <BackendToggleRow
                          key={backend.id}
                          active={backend.id === form.id}
                          color={backend.color ?? fallbackBackendColor(backend.id)}
                          enabled={enabled}
                          title={backend.name}
                          subtitle={backend.baseUrl}
                          toggleLabel={`${enabled ? "Disable" : "Enable"} ${backend.name}`}
                          onSelect={() => editBackend(backend)}
                          onToggle={() => bridge.setBridgeEnabled(backend.id, !enabled)}
                        />
                      );
                    })}
                    <button
                      className="backend-row-action"
                      type="button"
                      data-active={selectionMode === "new" ? "true" : undefined}
                      onClick={startNew}
                    >
                      <Plus size={14} />
                      <span>
                        <strong>Add bridge</strong>
                        <small>Save another bridge URL</small>
                      </span>
                    </button>
                  </div>
                  <div className="backend-form">
                    {selectionMode === "same-origin" ? (
                      <div className="backend-static">
                        <strong>This server</strong>
                        <span>
                          {sameOriginEnabled ? "Enabled" : "Disabled"}; uses the server that
                          delivered this web app.
                        </span>
                      </div>
                    ) : (
                      <>
                        <label className="field-label">
                          <span>Display name</span>
                          <input
                            className="field"
                            value={form.name}
                            placeholder="Home workstation"
                            autoComplete="off"
                            onChange={(event) =>
                              setForm((current) => ({ ...current, name: event.target.value }))
                            }
                          />
                        </label>
                        <label className="field-label">
                          <span>Bridge URL</span>
                          <input
                            className="field"
                            value={form.baseUrl}
                            placeholder="http://192.168.1.20:4000"
                            autoComplete="off"
                            spellCheck={false}
                            onBlur={validateDuplicate}
                            onChange={(event) =>
                              setForm((current) => ({ ...current, baseUrl: event.target.value }))
                            }
                          />
                        </label>
                        <label className="field-label">
                          <span>Bridge color</span>
                          <BackendColorControl
                            value={form.color}
                            defaultValue={
                              form.id
                                ? fallbackBackendColor(form.id)
                                : suggestBackendColor(bridge.store.backends)
                            }
                            onChange={(color) => setForm((current) => ({ ...current, color }))}
                          />
                        </label>
                        {selectedBackend?.lastConnectedAt ? (
                          <div className="backend-note">
                            Last used {formatDate(selectedBackend.lastConnectedAt)}
                          </div>
                        ) : null}
                      </>
                    )}
                    {selectedBackend ? (
                      <div className="backend-note">
                        {bridge.store.enabledBridgeIds.includes(selectedBackend.id)
                          ? "Enabled"
                          : "Disabled"}
                      </div>
                    ) : null}
                    {duplicate ? (
                      <div className="backend-warning">
                        This URL is already saved as {duplicate.name}.
                      </div>
                    ) : null}
                    {message ? <div className="modal-message">{message}</div> : null}
                  </div>
                </div>
                {editingBackend ? (
                  <div className="modal-actions">
                    {canDelete ? (
                      <button type="button" className="btn btn-danger" disabled={busy} onClick={deleteBackend}>
                        Delete
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || !form.baseUrl.trim()}
                      onClick={testBackend}
                    >
                      Test
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy || !form.baseUrl.trim()}
                      onClick={() => void saveBackend()}
                    >
                      Save
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}

            {activeArea === "appearance" ? (
              <AppearanceSettings terminalFontSizePx={terminalFontSizePx}
                onTerminalFontSizePx={onTerminalFontSizePx} />
            ) : null}

            {activeArea === "features" ? (
              <div className="settings-section settings-section-flat">
                <div className="settings-label">Client features</div>
                <div className="settings-row">
                  <span>Notes</span>
                  <div className="segmented-control" role="group" aria-label="Notes feature">
                    <button
                      type="button"
                      data-on={!notesEnabled}
                      aria-pressed={!notesEnabled}
                      onClick={() => onNotesEnabled(false)}
                    >
                      Off
                    </button>
                    <button
                      type="button"
                      data-on={notesEnabled}
                      aria-pressed={notesEnabled}
                      onClick={() => onNotesEnabled(true)}
                    >
                      On
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {activeArea === "documents" ? (
              <div className="settings-section settings-section-flat">
                <div className="settings-row"><span>PDF opening size</span>
                  <select className="settings-select" aria-label="PDF opening size" value={documentPrefs.pdfFit} onChange={e => updateDocumentPrefs({ pdfFit: e.target.value as "width" | "page" })}>
                    <option value="width">Fit width</option><option value="page">Fit page</option>
                  </select>
                </div>
                <div className="settings-row"><span>Remember reading position</span>
                  <BooleanSettingControl label="Remember reading position" value={documentPrefs.rememberPosition}
                    onChange={rememberPosition => updateDocumentPrefs({ rememberPosition })} />
                </div>
                <div className="settings-row"><span>Markdown opening mode</span>
                  <select className="settings-select" aria-label="Markdown opening mode" value={documentPrefs.markdownMode} onChange={e => updateDocumentPrefs({ markdownMode: e.target.value as "preview" | "source" })}>
                    <option value="preview">Rendered</option><option value="source">Source</option>
                  </select>
                </div>
                <div className="settings-row"><span>Remember expanded folders</span>
                  <BooleanSettingControl label="Remember expanded folders" value={documentPrefs.rememberFolders}
                    onChange={rememberFolders => updateDocumentPrefs({ rememberFolders })} />
                </div>
              </div>
            ) : null}
            {activeArea === "display" ? (
              <div className="settings-section settings-section-flat">
                <div className="settings-label">Opening view</div>
                <div className="settings-row">
                  <span>Default view</span>
                  <select className="settings-select" aria-label="Default view"
                    aria-describedby="default-view-help" value={defaultView}
                    onChange={event => onDefaultView(parseDefaultView(event.target.value))}>
                    <option value="conversation">Conversation</option>
                    <option value="terminal">Terminal</option>
                    <option value="remember">Remember last used</option>
                  </select>
                </div>
                <p className="settings-help" id="default-view-help">
                  Used when you open or refresh Passel. Remember last used restores this browser’s latest view.
                </p>
                <div className="settings-label">Sidebar</div>
                <div className="settings-row">
                  <span title="Choose whether this browser follows pane selections from other clients">
                    Sync navigation
                  </span>
                  <div
                    className="segmented-control"
                    role="group"
                    aria-label="Navigation synchronization"
                  >
                    <button
                      type="button"
                      data-on={navigationSyncMode === "independent"}
                      aria-pressed={navigationSyncMode === "independent"}
                      onClick={() => onNavigationSyncMode("independent")}
                    >
                      Off
                    </button>
                    <button
                      type="button"
                      data-on={navigationSyncMode === "shared"}
                      aria-pressed={navigationSyncMode === "shared"}
                      onClick={() => onNavigationSyncMode("shared")}
                    >
                      On
                    </button>
                  </div>
                </div>
                <div className="settings-row">
                  <span>Agent details in Sessions</span>
                  <div
                    className="segmented-control"
                    role="group"
                    aria-label="Agent details in Sessions"
                  >
                    <button
                      type="button"
                      data-on={!agentFeaturesInTabs}
                      aria-pressed={!agentFeaturesInTabs}
                      onClick={() => onAgentFeaturesInTabs(false)}
                    >
                      Off
                    </button>
                    <button
                      type="button"
                      data-on={agentFeaturesInTabs}
                      aria-pressed={agentFeaturesInTabs}
                      onClick={() => onAgentFeaturesInTabs(true)}
                    >
                      On
                    </button>
                  </div>
                </div>
                <div className="settings-row">
                  <span title="Combine same-named workspaces across hosts when grouping by Workspace">
                    Combine matching workspace names
                  </span>
                  <div
                    className="segmented-control"
                    role="group"
                    aria-label="Combine matching workspace names"
                  >
                    <button
                      type="button"
                      data-on={!combineMatchingWorkspaceNames}
                      aria-pressed={!combineMatchingWorkspaceNames}
                      onClick={() => onCombineMatchingWorkspaceNames(false)}
                    >
                      Off
                    </button>
                    <button
                      type="button"
                      data-on={combineMatchingWorkspaceNames}
                      aria-pressed={combineMatchingWorkspaceNames}
                      onClick={() => onCombineMatchingWorkspaceNames(true)}
                    >
                      On
                    </button>
                  </div>
                </div>
                <div className="settings-row">
                  <span>Multi-host Space selection</span>
                  <div
                    className="segmented-control"
                    role="group"
                    aria-label="Multi-host Space selection"
                  >
                    <button
                      type="button"
                      data-on={!multiHostSpaceSelection}
                      aria-pressed={!multiHostSpaceSelection}
                      onClick={() => onMultiHostSpaceSelection(false)}
                    >
                      Off
                    </button>
                    <button
                      type="button"
                      data-on={multiHostSpaceSelection}
                      aria-pressed={multiHostSpaceSelection}
                      onClick={() => onMultiHostSpaceSelection(true)}
                    >
                      On
                    </button>
                  </div>
                </div>
                <div className="settings-row"><span>Panel layout</span><button className="settings-layout-reset" type="button" onClick={onResetPanelLayout}>Reset panel layout</button></div>
                <div className="settings-label">Display spacing</div>
                <div className="settings-row">
                  <span>Top padding</span>
                  <NumberSettingControl
                    ariaLabel="Top padding"
                    value={contentInsetTopPx}
                    min={MIN_CONTENT_INSET_TOP_PX}
                    max={MAX_CONTENT_INSET_TOP_PX}
                    unit="px"
                    defaultValue={DEFAULT_CONTENT_INSET_TOP_PX}
                    onChange={(value) => onContentInsetTopPx(parseContentInsetTopPx(value))}
                  />
                </div>
                <div className="settings-row">
                  <span>Bottom padding</span>
                  <NumberSettingControl
                    ariaLabel="Bottom padding"
                    value={contentInsetBottomPx}
                    min={MIN_CONTENT_INSET_BOTTOM_PX}
                    max={MAX_CONTENT_INSET_BOTTOM_PX}
                    unit="px"
                    defaultValue={DEFAULT_CONTENT_INSET_BOTTOM_PX}
                    onChange={(value) => onContentInsetBottomPx(parseContentInsetBottomPx(value))}
                  />
                </div>
                {showMobileTerminalSettings ? (
                  <div className="settings-row settings-slider-row">
                    <span>Mobile input controls size</span>
                    <SliderSettingControl
                      ariaLabel="Mobile input controls size"
                      value={mobileControlsScalePercent}
                      min={MIN_MOBILE_CONTROLS_SCALE_PERCENT}
                      max={MAX_MOBILE_CONTROLS_SCALE_PERCENT}
                      step={5}
                      unit="%"
                      defaultValue={DEFAULT_MOBILE_CONTROLS_SCALE_PERCENT}
                      onChange={(value) =>
                        onMobileControlsScalePercent(parseMobileControlsScalePercent(value))
                      }
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            {activeArea === "terminal" ? (
              <div className="settings-section settings-section-flat">
                <TerminalStartupSetting key={serverKey} httpUrl={serverHttpUrl} serverLabel={serverLabel} />
                <div className="settings-label">Scrolling</div>
                <div className="settings-row">
                  <span>Scrolling speed</span>
                  <NumberSettingControl ariaLabel="Scrolling speed" value={terminalScrollSpeed}
                    min={50} max={300} step={25} unit="%" defaultValue={100}
                    onChange={value => onTerminalScrollSpeed(parseTerminalScrollSpeed(value))} />
                </div>
                <p className="settings-help">Applies to mouse, trackpad and touch scrolling. Swipe quickly to coast; touch again to stop.</p>
                <div className="settings-label">Terminal behaviour</div>
                {!showMobileTerminalSettings ? (
                  <div className="settings-row">
                    <span title="Cursor blinking can be expensive in ghostty-web 0.4.0 on large high-DPI terminals">
                      Cursor blink
                    </span>
                    <div
                      className="segmented-control"
                      role="group"
                      aria-label="Terminal cursor blink"
                    >
                      <button
                        type="button"
                        data-on={!terminalCursorBlink}
                        aria-pressed={!terminalCursorBlink}
                        onClick={() => onTerminalCursorBlink(false)}
                      >
                        Off
                      </button>
                      <button
                        type="button"
                        data-on={terminalCursorBlink}
                        aria-pressed={terminalCursorBlink}
                        onClick={() => onTerminalCursorBlink(true)}
                      >
                        On
                      </button>
                    </div>
                  </div>
                ) : null}
                {!showMobileTerminalSettings ? (
                  <>
                    <div className="settings-label">Command input</div>
                    <div className="settings-row">
                      <span title="Compose and edit commands below the terminal before sending them">
                        Command composer
                      </span>
                      <div
                        className="segmented-control"
                        role="group"
                        aria-label="Command composer"
                      >
                        <button
                          type="button"
                          data-on={!desktopCommandComposer}
                          aria-pressed={!desktopCommandComposer}
                          onClick={() => onDesktopCommandComposer(false)}
                        >
                          Off
                        </button>
                        <button
                          type="button"
                          data-on={desktopCommandComposer}
                          aria-pressed={desktopCommandComposer}
                          onClick={() => onDesktopCommandComposer(true)}
                        >
                          On
                        </button>
                      </div>
                    </div>
                    {desktopCommandComposer ? (
                      <div className="settings-row">
                        <span title="Use Ctrl+Enter on Windows/Linux or Cmd+Enter on macOS to send">
                          Enter inserts newline
                        </span>
                        <div
                          className="segmented-control"
                          role="group"
                          aria-label="Desktop composer Enter inserts newline"
                        >
                          <button
                            type="button"
                            data-on={!desktopCommandEnterNewline}
                            aria-pressed={!desktopCommandEnterNewline}
                            onClick={() => onDesktopCommandEnterNewline(false)}
                          >
                            Off
                          </button>
                          <button
                            type="button"
                            data-on={desktopCommandEnterNewline}
                            aria-pressed={desktopCommandEnterNewline}
                            onClick={() => onDesktopCommandEnterNewline(true)}
                          >
                            On
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : null}
                <div className="settings-label">Accessibility</div>
                <div className="settings-row">
                  <span title="Expose the visible terminal contents as screen-reader text; may add processing during heavy output">
                    Screen-reader text
                  </span>
                  <div
                    className="segmented-control"
                    role="group"
                    aria-label="Terminal screen-reader text"
                  >
                    <button
                      type="button"
                      data-on={!terminalScreenReaderText}
                      aria-pressed={!terminalScreenReaderText}
                      onClick={() => onTerminalScreenReaderText(false)}
                    >
                      Off
                    </button>
                    <button
                      type="button"
                      data-on={terminalScreenReaderText}
                      aria-pressed={terminalScreenReaderText}
                      onClick={() => onTerminalScreenReaderText(true)}
                    >
                      On
                    </button>
                  </div>
                </div>
                <div className="settings-label">Uploads</div>
                <div className="settings-row">
                  <span title="Add a numeric suffix when an uploaded filename already exists instead of asking whether to replace it">
                    Automatically rename conflicts
                  </span>
                  <div
                    className="segmented-control"
                    role="group"
                    aria-label="Automatically rename conflicting uploads"
                  >
                    <button
                      type="button"
                      data-on={!autoRenameUploadConflicts}
                      aria-pressed={!autoRenameUploadConflicts}
                      onClick={() => onAutoRenameUploadConflicts(false)}
                    >
                      Off
                    </button>
                    <button
                      type="button"
                      data-on={autoRenameUploadConflicts}
                      aria-pressed={autoRenameUploadConflicts}
                      onClick={() => onAutoRenameUploadConflicts(true)}
                    >
                      On
                    </button>
                  </div>
                </div>
                <details className="settings-advanced"><summary>Advanced</summary><div className="settings-label">Terminal transport</div>
                <div className="settings-row">
                  <span>Input payloads</span>
                  <div className="segmented-control" role="group" aria-label="Terminal input payloads">
                    <button
                      type="button"
                      data-on={terminalInputTransport === "json"}
                      aria-pressed={terminalInputTransport === "json"}
                      onClick={() => onTerminalInputTransport("json")}
                    >
                      JSON
                    </button>
                    <button
                      type="button"
                      data-on={terminalInputTransport === "binary"}
                      aria-pressed={terminalInputTransport === "binary"}
                      onClick={() => onTerminalInputTransport("binary")}
                    >
                      Binary
                    </button>
                  </div>
                </div>
                <div className="settings-row">
                  <span>Input batching (ms)</span>
                  <div className="segmented-control" role="group" aria-label="Terminal input batching">
                    {TERMINAL_INPUT_BATCH_DELAY_OPTIONS_MS.map((delayMs) => (
                      <button
                        key={delayMs}
                        type="button"
                        data-on={terminalInputBatchDelayMs === delayMs}
                        aria-pressed={terminalInputBatchDelayMs === delayMs}
                        onClick={() => onTerminalInputBatchDelayMs(delayMs)}
                      >
                        {delayMs === 0 ? "Off" : delayMs}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="settings-row">
                  <span>Output batching (ms)</span>
                  <div className="segmented-control" role="group" aria-label="Terminal output batching">
                    {TERMINAL_OUTPUT_COALESCE_OPTIONS_MS.map((delayMs) => (
                      <button
                        key={delayMs}
                        type="button"
                        data-on={terminalOutputCoalesceMs === delayMs}
                        aria-pressed={terminalOutputCoalesceMs === delayMs}
                        onClick={() => onTerminalOutputCoalesceMs(delayMs)}
                      >
                        {delayMs === 0 ? "Off" : delayMs}
                      </button>
                    ))}
                  </div>
                </div>
                </details>
              </div>
            ) : null}

            {activeArea === "mobile" && showMobileTerminalSettings ? (
              <div className="settings-section settings-section-flat">
                <div className="settings-label">Mobile terminal</div>
                <div className="settings-row">
                  <span>Terminal tap</span>
                  <div className="segmented-control" role="group" aria-label="Terminal tap target">
                    <button
                      type="button"
                      data-on={mobileTerminalTapTarget === "command-input"}
                      aria-pressed={mobileTerminalTapTarget === "command-input"}
                      onClick={() => onMobileTerminalTapTarget("command-input")}
                    >
                      Text input
                    </button>
                    <button
                      type="button"
                      data-on={mobileTerminalTapTarget === "terminal"}
                      aria-pressed={mobileTerminalTapTarget === "terminal"}
                      onClick={() => onMobileTerminalTapTarget("terminal")}
                    >
                      Terminal
                    </button>
                  </div>
                </div>
                <div className="settings-row">
                  <span>Long-press behavior</span>
                  <div className="segmented-control" role="group" aria-label="Long-press behavior">
                    <button
                      type="button"
                      data-on={mobileLongPressBehavior === "off"}
                      aria-pressed={mobileLongPressBehavior === "off"}
                      onClick={() => onMobileLongPressBehavior("off")}
                    >
                      Off
                    </button>
                    <button
                      type="button"
                      data-on={mobileLongPressBehavior === "copy"}
                      aria-pressed={mobileLongPressBehavior === "copy"}
                      onClick={() => onMobileLongPressBehavior("copy")}
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      data-on={mobileLongPressBehavior === "loupe"}
                      aria-pressed={mobileLongPressBehavior === "loupe"}
                      onClick={() => onMobileLongPressBehavior("loupe")}
                    >
                      Loupe
                    </button>
                  </div>
                </div>
                {mobileLongPressBehavior === "loupe" ? (
                  <div className="settings-row">
                    <span>Loupe wait (ms)</span>
                    <div
                      className="segmented-control"
                      role="group"
                      aria-label="Loupe endpoint wait"
                    >
                      {MOBILE_TOUCH_SELECTION_ENDPOINT_TIMEOUT_OPTIONS_MS.map((timeoutMs) => (
                        <button
                          key={timeoutMs}
                          type="button"
                          data-on={mobileTouchSelectionEndpointTimeoutMs === timeoutMs}
                          aria-pressed={mobileTouchSelectionEndpointTimeoutMs === timeoutMs}
                          onClick={() => onMobileTouchSelectionEndpointTimeoutMs(timeoutMs)}
                        >
                          {timeoutMs}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="settings-row">
                  <span>Expanding command input</span>
                  <div
                    className="segmented-control"
                    role="group"
                    aria-label="Expanding command input"
                  >
                    <button
                      type="button"
                      data-on={!mobileCommandExpandingInput}
                      aria-pressed={!mobileCommandExpandingInput}
                      onClick={() => onMobileCommandExpandingInput(false)}
                    >
                      Off
                    </button>
                    <button
                      type="button"
                      data-on={mobileCommandExpandingInput}
                      aria-pressed={mobileCommandExpandingInput}
                      onClick={() => onMobileCommandExpandingInput(true)}
                    >
                      On
                    </button>
                  </div>
                </div>
                <div className="settings-row">
                  <span>Focus command input after Send</span>
                  <div
                    className="segmented-control"
                    role="group"
                    aria-label="Focus command input after Send"
                  >
                    <button
                      type="button"
                      data-on={!mobileCommandFocusAfterSubmit}
                      aria-pressed={!mobileCommandFocusAfterSubmit}
                      onClick={() => onMobileCommandFocusAfterSubmit(false)}
                    >
                      Off
                    </button>
                    <button
                      type="button"
                      data-on={mobileCommandFocusAfterSubmit}
                      aria-pressed={mobileCommandFocusAfterSubmit}
                      onClick={() => onMobileCommandFocusAfterSubmit(true)}
                    >
                      On
                    </button>
                  </div>
                </div>
                {mobileCommandExpandingInput ? (
                  <div className="settings-row">
                    <span>Enter inserts newline</span>
                    <div
                      className="segmented-control"
                      role="group"
                      aria-label="Enter inserts newline"
                    >
                      <button
                        type="button"
                        data-on={!mobileCommandEnterNewline}
                        aria-pressed={!mobileCommandEnterNewline}
                        onClick={() => onMobileCommandEnterNewline(false)}
                      >
                        Off
                      </button>
                      <button
                        type="button"
                        data-on={mobileCommandEnterNewline}
                        aria-pressed={mobileCommandEnterNewline}
                        onClick={() => onMobileCommandEnterNewline(true)}
                      >
                        On
                      </button>
                    </div>
                  </div>
                ) : null}

              </div>
            ) : null}
          </div>
        </div>
      </form>
    </div>
  );
}

function BackendColorControl({
  value,
  defaultValue,
  onChange,
}: {
  value: string;
  defaultValue: string;
  onChange: (value: string) => void;
}) {
  const fallbackColor = normalizeBackendColor(defaultValue) ?? SAME_ORIGIN_BRIDGE_COLOR;
  const color = normalizeBackendColor(value) ?? fallbackColor;
  const [hsva, setHsva] = useState<HsvaColor>(() => hexToHsva(color));
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(color.toUpperCase());
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const skipDraftBlurCommitRef = useRef(false);
  const popoverId = useId();
  const shadeColor = hsvaToHex({ ...hsva, v: 100, a: 1 });

  useEffect(() => {
    setDraft(color.toUpperCase());
  }, [color]);

  useEffect(() => {
    setHsva((current) => (hsvaToHex({ ...current, a: 1 }) === color ? current : hexToHsva(color)));
  }, [color]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleClick = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [open]);

  const setColor = (nextColor: string) => {
    const normalized = normalizeBackendColor(nextColor);
    if (!normalized) {
      return;
    }
    setHsva(hexToHsva(normalized));
    onChange(normalized);
  };

  const setHsvaColor = (nextHsva: HsvaColor) => {
    const opaqueHsva = { ...nextHsva, a: 1 };
    const normalized = normalizeBackendColor(hsvaToHex(opaqueHsva));
    if (!normalized) {
      return;
    }
    setHsva(opaqueHsva);
    onChange(normalized);
  };

  const commitDraft = (nextDraft: string) => {
    const normalized = normalizeHexDraft(nextDraft);
    if (normalized) {
      setColor(normalized);
      return;
    }
    setDraft(color.toUpperCase());
  };

  const handleWheelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let nextHsva: HsvaColor | null = null;
    const hueStep = event.shiftKey ? 15 : 5;
    const saturationStep = event.shiftKey ? 10 : 5;
    if (event.key === "ArrowLeft") {
      nextHsva = { ...hsva, h: wrapHue(hsva.h - hueStep) };
    } else if (event.key === "ArrowRight") {
      nextHsva = { ...hsva, h: wrapHue(hsva.h + hueStep) };
    } else if (event.key === "ArrowDown") {
      nextHsva = { ...hsva, s: clampPercent(hsva.s - saturationStep) };
    } else if (event.key === "ArrowUp") {
      nextHsva = { ...hsva, s: clampPercent(hsva.s + saturationStep) };
    }
    if (!nextHsva) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setHsvaColor(nextHsva);
  };

  return (
    <div
      className="backend-color-control"
      ref={rootRef}
      onKeyDown={(event) => {
        if (!open || event.key !== "Escape") {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }}
    >
      <button
        className="backend-color-swatch"
        ref={buttonRef}
        type="button"
        aria-label="Bridge color"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-haspopup="true"
        style={{ "--bridge-color": color } as CSSProperties}
        onClick={() => setOpen((current) => !current)}
      />
      <input
        className="backend-color-value mono"
        value={draft}
        aria-label="Bridge color hex value"
        spellCheck={false}
        autoCapitalize="none"
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
        }}
        onBlur={(event) => {
          if (skipDraftBlurCommitRef.current) {
            skipDraftBlurCommitRef.current = false;
            return;
          }
          commitDraft(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            skipDraftBlurCommitRef.current = true;
            setDraft(color.toUpperCase());
            event.currentTarget.blur();
          }
        }}
      />
      {open ? (
        <div
          className="backend-color-popover"
          id={popoverId}
          role="group"
          aria-label="Bridge color picker"
        >
          <Wheel
            aria-label="Bridge color hue and saturation"
            color={hsva}
            width={176}
            height={176}
            onKeyDown={handleWheelKeyDown}
            onChange={(nextColor) => setHsvaColor(nextColor.hsva)}
          />
          <input
            className="backend-color-shade"
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(hsva.v)}
            aria-label="Bridge color brightness"
            style={{ "--shade-color": shadeColor } as CSSProperties}
            onChange={(event) => setHsvaColor({ ...hsva, v: event.currentTarget.valueAsNumber })}
          />
          <div className="backend-color-actions">
            <span className="backend-color-preview" style={{ "--bridge-color": color } as CSSProperties} />
            <button
              className="settings-reset icon-btn"
              type="button"
              aria-label="Reset bridge color"
              title="Reset"
              disabled={color === fallbackColor}
              onClick={() => setColor(fallbackColor)}
            >
              <RotateCcw size={13} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BooleanSettingControl({ label, value, onChange }: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return <div className="segmented-control" role="group" aria-label={label}>
    {[false, true].map(option => <button key={String(option)} type="button"
      data-on={value === option} aria-pressed={value === option} onClick={() => onChange(option)}>
      {option ? "On" : "Off"}
    </button>)}
  </div>;
}

function NumberSettingControl({
  ariaLabel,
  value,
  min,
  max,
  step = 1,
  unit,
  defaultValue,
  onChange,
}: {
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  defaultValue: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="settings-value-control">
      <DraftNumberInput
        ariaLabel={ariaLabel}
        value={value}
        min={min}
        max={max}
        step={step}
        onCommit={onChange}
      />
      <span className="settings-unit">{unit}</span>
      <ResetSettingButton
        disabled={value === defaultValue}
        label={`Reset ${ariaLabel.toLowerCase()}`}
        onClick={() => onChange(defaultValue)}
      />
    </div>
  );
}

function SliderSettingControl({
  ariaLabel,
  value,
  min,
  max,
  step,
  unit,
  defaultValue,
  onChange,
}: {
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  defaultValue: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="settings-slider-control">
      <input
        className="settings-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
      />
      <div className="settings-value-control">
        <DraftNumberInput
          ariaLabel={`${ariaLabel} percent`}
          value={value}
          min={min}
          max={max}
          step={step}
          onCommit={onChange}
        />
        <span className="settings-unit">{unit}</span>
        <ResetSettingButton
          disabled={value === defaultValue}
          label={`Reset ${ariaLabel.toLowerCase()}`}
          onClick={() => onChange(defaultValue)}
        />
      </div>
    </div>
  );
}

function DraftNumberInput({
  ariaLabel,
  value,
  min,
  max,
  step,
  onCommit,
}: {
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const skipDraftBlurCommitRef = useRef(false);

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const next = Number(draft);
    if (Number.isFinite(next)) {
      const clamped = Math.min(max, Math.max(min, next));
      setDraft(String(clamped));
      onCommit(clamped);
      return;
    }
    setDraft(String(value));
  };

  return (
    <input
      className="settings-number-field"
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      aria-label={ariaLabel}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => {
        if (skipDraftBlurCommitRef.current) {
          skipDraftBlurCommitRef.current = false;
          return;
        }
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          skipDraftBlurCommitRef.current = true;
          setDraft(String(value));
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function ResetSettingButton({
  disabled,
  label,
  onClick,
}: {
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="settings-reset icon-btn"
      type="button"
      aria-label={label}
      title="Reset"
      disabled={disabled}
      onClick={onClick}
    >
      <RotateCcw size={13} />
    </button>
  );
}

function BackendToggleRow({
  active,
  color,
  enabled,
  title,
  subtitle,
  toggleLabel,
  onSelect,
  onToggle,
}: {
  active: boolean;
  color: string;
  enabled: boolean;
  title: string;
  subtitle: string;
  toggleLabel: string;
  onSelect: () => void;
  onToggle: () => void;
}) {
  return (
    <div className="backend-row" data-active={active ? "true" : undefined} role="listitem">
      <button className="backend-row-main" type="button" onClick={onSelect}>
        <span
          className="backend-row-dot"
          style={{ "--bridge-color": color } as CSSProperties}
          aria-hidden="true"
        />
        <span className="backend-row-text">
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </span>
      </button>
      <button
        className="backend-toggle"
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={toggleLabel}
        title={toggleLabel}
        data-on={enabled ? "true" : undefined}
        onClick={onToggle}
      >
        <span aria-hidden="true" />
      </button>
    </div>
  );
}

function newBackendForm(backends: readonly BridgeBackendProfile[]): FormState {
  return {
    id: null,
    name: "",
    baseUrl: "",
    color: suggestBackendColor(backends),
  };
}

function backendFormFromProfile(backend: BridgeBackendProfile): FormState {
  return {
    id: backend.id,
    name: backend.name,
    baseUrl: backend.baseUrl,
    color: backend.color ?? fallbackBackendColor(backend.id),
  };
}

function normalizeHexDraft(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return normalizeBackendColor(trimmed.startsWith("#") ? trimmed : `#${trimmed}`);
}

function wrapHue(value: number) {
  return ((value % 360) + 360) % 360;
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

function sameOriginDisplayUrl() {
  const location = globalThis.location;
  if (!location?.origin || location.origin === "null") {
    return "same-origin";
  }
  return location.origin;
}

function initialSelectionMode(
  lastSelectedBridgeId: string | null,
  sameOriginAvailable: boolean,
): SelectionMode {
  if (lastSelectedBridgeId && lastSelectedBridgeId !== SAME_ORIGIN_BRIDGE_ID) {
    return "backend";
  }
  return sameOriginAvailable ? "same-origin" : "new";
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function AppearanceSettings({ terminalFontSizePx, onTerminalFontSizePx }: {
  terminalFontSizePx: number; onTerminalFontSizePx: (value: number) => void;
}) {
  const prefs = useAppearancePrefs(), systemDark = useSystemDark();
  const theme = effectiveTheme(prefs, systemDark);
  return <div className="settings-section settings-section-flat appearance-settings">
    <div className="settings-label">Colour theme</div>
    <div className="appearance-theme-grid" role="group" aria-label="Colour theme">
      {APPEARANCE_THEMES.map(preset => <button type="button" key={preset.id}
        className="appearance-theme-card" aria-pressed={theme.id === preset.id}
        data-selected={theme.id === preset.id} onClick={() => updateAppearancePrefs({ theme: preset.id, followSystem: false })}>
        <span className="appearance-theme-swatches" style={{ background: preset.base }} aria-hidden="true">
          {[preset.text, preset.accent, preset.blue, preset.magenta, preset.green].map((color, i) =>
            <span key={i} style={{ background: color }} />)}
          {preset.id === "tig" ? <span className="appearance-unicorn">🦄</span> : null}
        </span>
        <span>{preset.name}</span>
      </button>)}
    </div>
    <div className="settings-row"><span>Follow system light/dark</span>
      <BooleanSettingControl label="Follow system light/dark" value={prefs.followSystem}
        onChange={followSystem => updateAppearancePrefs({ followSystem })} /></div>
    <p className="settings-help">Uses Dark or Light with your device. Selecting a preset turns this off.</p>
    <div className="settings-row"><span>Accent colour</span><div className="settings-value-control">
      <input type="color" className="appearance-accent-input" aria-label="Accent colour"
        value={prefs.accent ?? theme.accent} onChange={event => updateAppearancePrefs({ accent: event.currentTarget.value })} />
      <ResetSettingButton label="Reset accent colour" disabled={prefs.accent === null}
        onClick={() => updateAppearancePrefs({ accent: null })} />
    </div></div>

    <div className="appearance-preview" aria-label="Appearance preview">
      <div className="appearance-preview-heading">Live preview</div>
      <div className="appearance-preview-reading">
        <div className="appearance-preview-user">What do we know about this surface?</div>
        <p>Here is the latest result, with a <span className="appearance-preview-link">saved proof</span>.</p>
        <p><i>X</i> = ℙ(Ω¹),&nbsp; <i>L</i> = 𝒪(1)</p>
      </div>
      <div className="appearance-preview-terminal" aria-label="Terminal preview" style={{ fontSize: `${terminalFontSizePx}px` }}>$ codex resume …<br />Ready for your next question.</div>
    </div>

    <div className="settings-label">Conversation Mode</div>
    <div className="settings-row"><span>Font</span><select className="settings-select" aria-label="Conversation font"
      value={prefs.readingFont} onChange={event => updateAppearancePrefs({ readingFont: event.currentTarget.value as ReadingFont })}>
      {Object.entries(READING_FONTS).map(([id, font]) => <option key={id} value={id}>{font.label}</option>)}
    </select></div>
    <div className="settings-row"><span>Font size</span><NumberSettingControl ariaLabel="Conversation font size"
      value={prefs.readingSize} min={12} max={24} unit="px" defaultValue={16}
      onChange={readingSize => updateAppearancePrefs({ readingSize })} /></div>
    <div className="settings-row"><span>Line spacing</span><NumberSettingControl ariaLabel="Conversation line spacing"
      value={prefs.lineHeight} min={130} max={210} step={5} unit="%" defaultValue={165}
      onChange={lineHeight => updateAppearancePrefs({ lineHeight })} /></div>
    <div className="settings-row"><span>Reading width</span><NumberSettingControl ariaLabel="Conversation reading width"
      value={prefs.readingWidth} min={560} max={1400} step={20} unit="px" defaultValue={900}
      onChange={readingWidth => updateAppearancePrefs({ readingWidth })} /></div>
    <div className="settings-row"><span>Compact message spacing</span><BooleanSettingControl label="Compact message spacing"
      value={prefs.compactMessages} onChange={compactMessages => updateAppearancePrefs({ compactMessages })} /></div>
    <div className="settings-row"><span>Box opacity</span><SliderSettingControl ariaLabel="Conversation box opacity"
      value={prefs.conversationOpacity} min={0} max={100} step={5} unit="%" defaultValue={100}
      onChange={conversationOpacity => updateAppearancePrefs({ conversationOpacity })} /></div>

    <div className="settings-label">Terminal Mode</div>
    <div className="settings-row"><span>Font</span><select className="settings-select" aria-label="Terminal font"
      value={prefs.terminalFont} onChange={event => updateAppearancePrefs({ terminalFont: event.currentTarget.value as TerminalFont })}>
      {Object.entries(TERMINAL_FONTS).map(([id, font]) => <option key={id} value={id}>{font.label}</option>)}
    </select></div>
    <p className="settings-help">Fonts use those installed on your device, with a monospace fallback.</p>
    <div className="settings-row"><span>Font size</span><NumberSettingControl ariaLabel="Terminal font size"
      value={terminalFontSizePx} min={MIN_TERMINAL_FONT_SIZE_PX} max={MAX_TERMINAL_FONT_SIZE_PX}
      unit="px" defaultValue={DEFAULT_TERMINAL_FONT_SIZE_PX}
      onChange={value => onTerminalFontSizePx(parseTerminalFontSizePx(value))} /></div>
    <div className="settings-row"><span>Background opacity</span><SliderSettingControl ariaLabel="Terminal background opacity"
      value={prefs.terminalOpacity} min={0} max={100} step={5} unit="%" defaultValue={100}
      onChange={terminalOpacity => updateAppearancePrefs({ terminalOpacity })} /></div>
    <p className="settings-help">Opacity affects backgrounds, not text. Terminal apps can supply their own colours.</p>
    <div className="settings-label">Interface</div>
    <div className="settings-row"><span>Reduce motion</span><BooleanSettingControl label="Reduce motion"
      value={prefs.reducedMotion} onChange={reducedMotion => updateAppearancePrefs({ reducedMotion })} /></div>
    <p className="settings-help">Your device’s reduced-motion preference is also respected. These settings are saved on this browser/device.</p>
    <button type="button" className="btn" onClick={() => { updateAppearancePrefs(DEFAULT_APPEARANCE); onTerminalFontSizePx(DEFAULT_TERMINAL_FONT_SIZE_PX); }}>Reset appearance</button>
  </div>;
}
