import { describe, expect, it } from "vitest";
import { loadRulesUser, saveRulesUser, USER_GLOSSARY_KEY, USER_RULES_KEY } from "./storage";

function createStorage(seed: Record<string, string> = {}): Storage {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key) ?? null : null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  } as Storage;
}

describe("rules/storage", () => {
  it("loads rules from user_rules storage key", () => {
    const storage = createStorage({
      [USER_RULES_KEY]: JSON.stringify([
        { phrase: "VR", mode: "deny", reason: "x", replacements: ["виртуальная реальность"] },
      ]),
    });
    const loaded = loadRulesUser(storage);
    expect(loaded).toEqual([
      { phrase: "vr", mode: "deny", reason: "x", replacements: ["виртуальная реальность"] },
    ]);
  });

  it("falls back to legacy glossary when user_rules is absent", () => {
    const storage = createStorage({
      [USER_GLOSSARY_KEY]: JSON.stringify([
        { original: "VR", replacements: ["виртуальная реальность"] },
      ]),
    });
    const loaded = loadRulesUser(storage);
    expect(loaded).toEqual([
      { phrase: "vr", mode: "deny", reason: "", replacements: ["виртуальная реальность"] },
    ]);
  });

  it("saves normalized list to user_rules", () => {
    const storage = createStorage();
    saveRulesUser(storage, [{ phrase: "vr", mode: "deny", reason: "", replacements: ["виртуальная реальность"] }]);
    expect(JSON.parse(storage.getItem(USER_RULES_KEY) ?? "[]")).toEqual([
      { phrase: "vr", mode: "deny", reason: "", replacements: ["виртуальная реальность"] },
    ]);
  });
});
