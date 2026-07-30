import { describe, expect, test } from "bun:test";
import { getAdapters, getDetectedAdapters } from "./index.js";

describe("adapter registry", () => {
  test("contains every supported client in stable fan-out order", () => {
    expect(getAdapters().map((adapter) => adapter.name)).toEqual([
      "claude-code",
      "cursor",
      "vscode",
      "codex",
    ]);
  });

  test("detected registry is a subset of registered adapters", async () => {
    const registered = new Set(getAdapters().map((adapter) => adapter.name));
    const detected = await getDetectedAdapters();
    expect(detected.every((adapter) => registered.has(adapter.name))).toBe(
      true,
    );
  });
});
