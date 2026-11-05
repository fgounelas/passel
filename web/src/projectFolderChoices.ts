const STORAGE_KEY = "herdr-project-folder-choices-v1";
const MAX_CHOICES = 100;
type Choice = { id: string; path: string };

export function projectFolderChoiceKey(bridge: string, terminal: string, cwd: string) {
  return JSON.stringify([bridge, terminal, cwd]);
}

function validPath(path: unknown): path is string {
  if (typeof path !== "string" || path.length > 1024 ||
    [...path].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return false;
  const parts = path.split("/");
  return parts.length <= 24 && parts.every(part => part !== "" && !part.startsWith(".") && !part.includes("\\"));
}

export function createProjectFolderChoices(storage: () => Pick<Storage, "getItem" | "setItem"> | null) {
  let memory: Choice[] = [];
  let volatile = false;
  const read = (): Choice[] => {
    if (volatile) return memory;
    try {
      const raw = storage()?.getItem(STORAGE_KEY);
      if (!raw) return [];
      if (raw.length > 400_000) return [];
      const value: unknown = JSON.parse(raw);
      if (!Array.isArray(value)) return [];
      return value.slice(-MAX_CHOICES).filter((entry): entry is Choice => entry &&
        typeof entry.id === "string" && entry.id.length <= 2048 && validPath(entry.path));
    } catch { return memory; }
  };
  return {
    get(id: string): string | undefined { return read().find(entry => entry.id === id)?.path; },
    set(id: string, path: string) {
      if (id.length > 2048 || !validPath(path)) return;
      memory = [...read().filter(entry => entry.id !== id), {id, path}].slice(-MAX_CHOICES);
      try {
        const target = storage();
        if (!target) { volatile = true; return; }
        target.setItem(STORAGE_KEY, JSON.stringify(memory));
      } catch { volatile = true; }
    },
  };
}

export const projectFolderChoices = createProjectFolderChoices(() => {
  try { return window.localStorage; } catch { return null; }
});
