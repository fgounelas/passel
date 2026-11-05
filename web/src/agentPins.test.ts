import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentPinsApiError,
  agentPinKey,
  agentPinKeys,
  fetchAgentPins,
  parseAgentPinsListResponse,
  pinAgent,
  supportsAgentPins,
} from "./agentPins";

describe("agent pin helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("checks the bridge agent pins capability", () => {
    expect(supportsAgentPins({ commands: [], agent_pins: { version: 1 } })).toBe(true);
    expect(supportsAgentPins({ commands: [] })).toBe(false);
    expect(supportsAgentPins(null)).toBe(false);
  });

  it("builds scoped pin keys", () => {
    expect(agentPinKey("bridge-a", "pane-a")).toBe("bridge-a:pane-a");
    expect(
      [...agentPinKeys("bridge-a", {
        session_key: "session:default",
        pins: [
          {
            pane_id: "pane-a",
            terminal_id: "terminal-a",
            workspace_id: "workspace-a",
            tab_id: "tab-a",
            created_at: "100",
            context: {},
          },
        ],
      })],
    ).toEqual(["bridge-a:pane-a"]);
  });

  it("rejects malformed 200 responses at the fetch boundary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ session_key: "session:default", pins: "nope" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(fetchAgentPins((path) => `http://bridge${path}`)).rejects.toThrow(
      "agent pins response is invalid",
    );
  });

  it("validates pin records and tolerates missing context", () => {
    expect(
      parseAgentPinsListResponse({
        session_key: "session:default",
        pins: [
          {
            pane_id: "pane-a",
            terminal_id: "terminal-a",
            workspace_id: "workspace-a",
            tab_id: "tab-a",
            created_at: "100",
            context: { pane_label: "build", ignored: 3 },
          },
        ],
      }),
    ).toEqual({
      session_key: "session:default",
      pins: [
        {
          pane_id: "pane-a",
          terminal_id: "terminal-a",
          workspace_id: "workspace-a",
          tab_id: "tab-a",
          created_at: "100",
          context: { pane_label: "build" },
        },
      ],
    });
    expect(() =>
      parseAgentPinsListResponse({
        session_key: "session:default",
        pins: [{ pane_id: 5 }],
      }),
    ).toThrow("agent pin record is invalid");
  });

  it("preserves HTTP status for pin errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "pane not found: pane-a" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(pinAgent((path) => `http://bridge${path}`, "pane-a")).rejects.toMatchObject({
      name: "AgentPinsApiError",
      status: 400,
      message: "pane not found: pane-a",
    });

    expect(new AgentPinsApiError("bad", 400).status).toBe(400);
  });
});
