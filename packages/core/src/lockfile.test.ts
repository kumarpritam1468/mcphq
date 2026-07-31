import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { McpServer } from "./canonical.js";
import {
  hashServer,
  LOCKFILE_NAME,
  lockfilePathFor,
  readLockfile,
  removeLockfileEntries,
  updateLockfileEntries,
  writeLockfile,
} from "./lockfile.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcphq-lockfile-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const github: McpServer = {
  name: "github",
  scope: "project",
  transport: "stdio",
  command: "npx",
  args: ["-y", "server-github"],
  env: { TOKEN: "x" },
};

describe("hashServer", () => {
  test("is stable regardless of key insertion order", () => {
    const a: McpServer = { ...github, env: { A: "1", B: "2" } };
    const b: McpServer = {
      ...github,
      env: { B: "2", A: "1" } as Record<string, string>,
    };
    expect(hashServer(a)).toBe(hashServer(b));
  });

  test("changes when an owned field changes", () => {
    const changed: McpServer = { ...github, command: "npx-other" };
    expect(hashServer(github)).not.toBe(hashServer(changed));
  });

  test("differs between a stdio and http server with the same name", () => {
    const http: McpServer = {
      name: "github",
      scope: "project",
      transport: "http",
      url: "https://mcp.example.com",
      headers: {},
    };
    expect(hashServer(github)).not.toBe(hashServer(http));
  });
});

describe("readLockfile / writeLockfile", () => {
  test("readLockfile returns an empty lockfile when the file does not exist", () => {
    const lockfile = readLockfile(
      lockfilePathFor(path.join(tmp, "mcp.config.json")),
    );
    expect(lockfile).toEqual({ version: 1, clients: {} });
  });

  test("round-trips through write and read", () => {
    const file = lockfilePathFor(path.join(tmp, "mcp.config.json"));
    const lockfile = updateLockfileEntries(
      { version: 1, clients: {} },
      "claude-code",
      "project",
      [github],
    );
    writeLockfile(file, lockfile);
    expect(readLockfile(file)).toEqual(lockfile);
  });

  test("updateLockfileEntries overwrites only the given client+scope", () => {
    let lockfile = updateLockfileEntries(
      { version: 1, clients: {} },
      "claude-code",
      "project",
      [github],
    );
    lockfile = updateLockfileEntries(lockfile, "codex", "project", [github]);
    expect(Object.keys(lockfile.clients)).toEqual(["claude-code", "codex"]);
  });

  test("removeLockfileEntries drops named servers from one client+scope", () => {
    let lockfile = updateLockfileEntries(
      { version: 1, clients: {} },
      "claude-code",
      "project",
      [github],
    );
    lockfile = removeLockfileEntries(lockfile, "claude-code", "project", [
      "github",
    ]);
    expect(lockfile.clients["claude-code"]?.project ?? {}).toEqual({});
  });
});
