import { expect, it } from "vitest";
import { createProjectFolderChoices, projectFolderChoiceKey } from "./projectFolderChoices";

it("persists choices across stores, isolated by bridge, terminal and working directory", () => {
  const values = new Map<string, string>();
  const storage = {getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }};
  const id = projectFolderChoiceKey("primary", "term-example", "/home/example/work/danus");
  createProjectFolderChoices(() => storage).set(id, "danus/runtime/projects/example");
  const choices = createProjectFolderChoices(() => storage);
  expect(choices.get(id)).toBe("danus/runtime/projects/example");
  choices.set("ordinary", "Example/drafts");
  expect(createProjectFolderChoices(() => storage).get("ordinary")).toBe("Example/drafts");
  expect(choices.get(projectFolderChoiceKey("secondary", "term-example", "/home/example/work/danus"))).toBeUndefined();
  expect(choices.get(projectFolderChoiceKey("primary", "term-other", "/home/example/work/danus"))).toBeUndefined();
  expect(choices.get(projectFolderChoiceKey("primary", "term-example", "/home/example/work/danus-mine"))).toBeUndefined();
});

it("bounds saved choices and ignores corrupt or unsafe paths", () => {
  let raw = "not JSON";
  const storage = {getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; }};
  const choices = createProjectFolderChoices(() => storage);
  expect(choices.get("one")).toBeUndefined();
  for (const path of ["/home/example/.codex", "danus/runtime/projects/..", "../runtime/projects/example", "danus/runtime/projects/a\n"]) {
    choices.set("one", path); expect(choices.get("one")).toBeUndefined();
  }
  for (let i = 0; i < 101; i += 1) choices.set(String(i), `danus/runtime/projects/p${i}`);
  expect(JSON.parse(raw)).toHaveLength(100);
  expect(choices.get("0")).toBeUndefined();
  expect(choices.get("100")).toBe("danus/runtime/projects/p100");
});

it("remembers for this page when browser storage is unavailable or full", () => {
  const choices = createProjectFolderChoices(() => ({getItem: () => null, setItem: () => {throw new Error("Quota");}}));
  choices.set("one", "danus/runtime/projects/example");
  expect(choices.get("one")).toBe("danus/runtime/projects/example");
  const privateChoices = createProjectFolderChoices(() => null);
  privateChoices.set("one", "danus/runtime/projects/example");
  expect(privateChoices.get("one")).toBe("danus/runtime/projects/example");
});
