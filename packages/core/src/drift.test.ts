import { describe, expect, test } from "bun:test";
import type { McpServer } from "./canonical.js";
import { computeDrift } from "./drift.js";
import { type LockFile, updateLockfileEntries } from "./lockfile.js";

const github: McpServer = {
  name: "github",
  scope: "project",
  transport: "stdio",
  command: "npx",
  args: ["-y", "server-github"],
  env: {},
};

function synced(servers: McpServer[]): LockFile {
  return updateLockfileEntries(
    { version: 1, clients: {} },
    "claude-code",
    "project",
    servers,
  );
}

describe("computeDrift", () => {
  test("reports nothing when current matches last synced", () => {
    const lockfile = synced([github]);
    expect(computeDrift(lockfile, "claude-code", "project", [github])).toEqual(
      [],
    );
  });

  test("reports 'modified' with before/after when an owned field changed", () => {
    const lockfile = synced([github]);
    const edited: McpServer = { ...github, command: "npx-other" };
    const drift = computeDrift(lockfile, "claude-code", "project", [edited]);
    expect(drift).toEqual([
      {
        server: "github",
        status: "modified",
        lastSynced: { command: "npx", args: ["-y", "server-github"] },
        current: { command: "npx-other", args: ["-y", "server-github"] },
      },
    ]);
  });

  test("reports 'removed' when a tracked server is gone from the client", () => {
    const lockfile = synced([github]);
    expect(computeDrift(lockfile, "claude-code", "project", [])).toEqual([
      {
        server: "github",
        status: "removed",
        lastSynced: { command: "npx", args: ["-y", "server-github"] },
        current: undefined,
      },
    ]);
  });

  test("ignores servers mcphq never synced (hand-added, not owned)", () => {
    const lockfile: LockFile = { version: 1, clients: {} };
    expect(computeDrift(lockfile, "claude-code", "project", [github])).toEqual(
      [],
    );
  });

  test("ignores a different client's lockfile entries", () => {
    const lockfile = synced([github]);
    expect(computeDrift(lockfile, "codex", "project", [])).toEqual([]);
  });
});
