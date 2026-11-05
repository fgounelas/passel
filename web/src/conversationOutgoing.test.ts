import { expect, it } from "vitest";
import { createCommandDraftStore } from "./commandDrafts";

it("bounds pending messages, isolates panes and servers, and releases closed-pane state", () => {
  const store = createCommandDraftStore();
  const entries = Array.from({ length: 12 }, (_, i) => ({ id: String(i), text: `Message ${i}`, session: "thread", first: false, knownIds: [], sent: true }));
  store.updateOutgoing("primary", "pane", () => entries);
  expect(store.getOutgoing("primary", "pane")).toHaveLength(10);
  expect(store.getOutgoing("secondary", "pane")).toHaveLength(0);
  expect(store.getOutgoing("primary", "other")).toHaveLength(0);
  store.updateOutgoing("secondary", "pane", () => [entries[0]]);
  store.retainPanes("primary", []);
  expect(store.getOutgoing("primary", "pane")).toHaveLength(0);
  expect(store.getOutgoing("secondary", "pane")).toHaveLength(1);
});
