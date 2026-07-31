import { describe, expect, test } from "bun:test";
import {
  type ConfigFile,
  computeDrift,
  type LockFile,
  type McpServer,
  updateLockfileEntries,
} from "@mcphq/core";
import { applyKeepTheirs, updateLockfileAfterKeepTheirs } from "./doctor.js";

describe("applyKeepTheirs", () => {
  const base: ConfigFile = {
    servers: {
      alpha: { command: "node", args: ["a.js"] },
      beta: { command: "node", args: ["b.js"] },
    },
  };

  test("accumulates across sequential calls in one doctor run (regression: stale config)", () => {
    // Simulates reconciling two drifted servers, keep-theirs, in one run.
    // If the second call were fed `base` again instead of the first call's
    // output, beta's edit would survive but alpha's would be silently lost.
    const afterAlpha = applyKeepTheirs(base, {
      server: "alpha",
      status: "modified",
      current: { command: "node-alpha-edited", args: ["a.js"] },
    });
    const afterBeta = applyKeepTheirs(afterAlpha, {
      server: "beta",
      status: "modified",
      current: { command: "node-beta-edited", args: ["b.js"] },
    });

    expect(afterBeta.servers.alpha?.command).toBe("node-alpha-edited");
    expect(afterBeta.servers.beta?.command).toBe("node-beta-edited");
  });

  test("removed status deletes the server from the config", () => {
    const result = applyKeepTheirs(base, {
      server: "alpha",
      status: "removed",
      current: undefined,
    });
    expect(result.servers.alpha).toBeUndefined();
    expect(result.servers.beta).toBeDefined();
  });
});

describe("updateLockfileAfterKeepTheirs", () => {
  test("modified + keep-theirs: lockfile no longer flags drift against the client's current value (regression: doctor re-reporting resolved drift)", () => {
    const originallySynced: McpServer = {
      name: "alpha",
      scope: "project",
      transport: "stdio",
      command: "node",
      args: ["a.js"],
      env: {},
    };
    const handEdited: McpServer = {
      ...originallySynced,
      command: "node-edited",
    };

    let lockfile: LockFile = { version: 1, clients: {} };
    lockfile = updateLockfileEntries(lockfile, "claude-code", "project", [
      originallySynced,
    ]);

    // Sanity: before reconciling, the hand-edit is flagged as drift.
    expect(
      computeDrift(lockfile, "claude-code", "project", [handEdited]),
    ).not.toEqual([]);

    // keep-theirs: pull the client's current value into the lockfile too.
    lockfile = updateLockfileAfterKeepTheirs(
      lockfile,
      "claude-code",
      "project",
      "alpha",
      handEdited,
    );

    expect(
      computeDrift(lockfile, "claude-code", "project", [handEdited]),
    ).toEqual([]);
  });

  test("removed + keep-theirs: lockfile stops tracking the server", () => {
    const originallySynced: McpServer = {
      name: "alpha",
      scope: "project",
      transport: "stdio",
      command: "node",
      args: ["a.js"],
      env: {},
    };
    let lockfile: LockFile = { version: 1, clients: {} };
    lockfile = updateLockfileEntries(lockfile, "claude-code", "project", [
      originallySynced,
    ]);

    lockfile = updateLockfileAfterKeepTheirs(
      lockfile,
      "claude-code",
      "project",
      "alpha",
      undefined,
    );

    // Nothing left to track, so computeDrift against an empty client never
    // reports "alpha" as removed-drift again.
    expect(computeDrift(lockfile, "claude-code", "project", [])).toEqual([]);
  });
});
