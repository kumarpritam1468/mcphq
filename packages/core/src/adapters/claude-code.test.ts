import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { McpServer } from "../canonical.js";
import { ClaudeCodeAdapter } from "./claude-code.js";

let tmp: string;
let adapter: ClaudeCodeAdapter;
let globalFile: string;
let projectFile: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcphq-claude-"));
  globalFile = path.join(tmp, ".claude.json");
  projectFile = path.join(tmp, "project", ".mcp.json");
  adapter = new ClaudeCodeAdapter({
    projectDir: path.join(tmp, "project"),
    globalConfigPath: globalFile,
  });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const stdioServer: McpServer = {
  name: "github",
  scope: "project",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github"],
  env: { GITHUB_TOKEN: "tok" },
};

const remoteServer: McpServer = {
  name: "linear",
  scope: "project",
  transport: "sse",
  url: "https://mcp.linear.app/sse",
  headers: {},
};

describe("round-trip", () => {
  test("write → read returns the same canonical servers", async () => {
    await adapter.write([stdioServer, remoteServer], { scope: "project" });
    const { servers, warnings } = await adapter.read("project");
    expect(warnings).toEqual([]);
    expect(servers).toEqual([stdioServer, remoteServer]);
  });

  test("second write is a no-op (unchanged), file identical", async () => {
    await adapter.write([stdioServer], { scope: "project" });
    const before = fs.readFileSync(projectFile, "utf8");
    const result = await adapter.write([stdioServer], { scope: "project" });
    expect(result.written).toBe(false);
    expect(result.changes).toEqual([{ server: "github", action: "unchanged" }]);
    expect(fs.readFileSync(projectFile, "utf8")).toBe(before);
  });
});

describe("merge-never-clobber", () => {
  test("global write only touches mcpServers, other state survives byte-for-byte", async () => {
    fs.writeFileSync(
      globalFile,
      JSON.stringify({
        numStartups: 42,
        projects: { "/some/path": { history: [1, 2, 3] } },
        mcpServers: { manual: { command: "my-server", args: ["--x"] } },
      }),
    );
    const server: McpServer = { ...stdioServer, scope: "global" };
    const result = await adapter.write([server], { scope: "global" });
    expect(result.written).toBe(true);
    expect(result.backupPath).toBe(`${globalFile}.mcphq-backup`);

    const after = JSON.parse(fs.readFileSync(globalFile, "utf8"));
    expect(after.numStartups).toBe(42);
    expect(after.projects).toEqual({ "/some/path": { history: [1, 2, 3] } });
    // the hand-added server survives untouched
    expect(after.mcpServers.manual).toEqual({
      command: "my-server",
      args: ["--x"],
    });
    expect(after.mcpServers.github.command).toBe("npx");
  });

  test("unknown keys on a managed entry are preserved on update", async () => {
    fs.mkdirSync(path.dirname(projectFile), { recursive: true });
    fs.writeFileSync(
      projectFile,
      JSON.stringify({
        mcpServers: {
          github: { command: "old-cmd", customFlag: true },
        },
      }),
    );
    await adapter.write([stdioServer], { scope: "project" });
    const after = JSON.parse(fs.readFileSync(projectFile, "utf8"));
    expect(after.mcpServers.github.customFlag).toBe(true);
    expect(after.mcpServers.github.command).toBe("npx");
  });
});

describe("dry run", () => {
  test("reports changes without touching the filesystem", async () => {
    const result = await adapter.write([stdioServer], {
      scope: "project",
      dryRun: true,
    });
    expect(result.written).toBe(false);
    expect(result.changes).toEqual([{ server: "github", action: "add" }]);
    expect(fs.existsSync(projectFile)).toBe(false);
  });

  test("update includes field-level details", async () => {
    await adapter.write([stdioServer], { scope: "project" });
    const changed = { ...stdioServer, command: "bunx" };
    const result = await adapter.write([changed], {
      scope: "project",
      dryRun: true,
    });
    expect(result.changes[0]?.action).toBe("update");
    expect(result.changes[0]?.details?.join("\n")).toContain('"npx" → "bunx"');
  });
});

describe("read robustness", () => {
  test("missing file reads as zero servers", async () => {
    const { servers, warnings } = await adapter.read("project");
    expect(servers).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test("unintelligible entries produce warnings, not failures", async () => {
    fs.mkdirSync(path.dirname(projectFile), { recursive: true });
    fs.writeFileSync(
      projectFile,
      JSON.stringify({
        mcpServers: {
          ok: { command: "x" },
          bad: { neither: "command nor url" },
        },
      }),
    );
    const { servers, warnings } = await adapter.read("project");
    expect(servers.map((s) => s.name)).toEqual(["ok"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"bad"');
  });

  test("stdio entry without explicit type reads as stdio", async () => {
    fs.mkdirSync(path.dirname(projectFile), { recursive: true });
    fs.writeFileSync(
      projectFile,
      JSON.stringify({ mcpServers: { plain: { command: "x" } } }),
    );
    const { servers } = await adapter.read("project");
    expect(servers[0]?.transport).toBe("stdio");
  });
});
