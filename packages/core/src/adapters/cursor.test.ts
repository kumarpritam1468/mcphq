import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { McpServer } from "../canonical.js";
import { CursorAdapter } from "./cursor.js";

let tmp: string;
let adapter: CursorAdapter;
let projectFile: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcphq-cursor-"));
  const projectDir = path.join(tmp, "project");
  projectFile = path.join(projectDir, ".cursor", "mcp.json");
  adapter = new CursorAdapter({
    projectDir,
    globalConfigPath: path.join(tmp, "global", "mcp.json"),
    homeDir: tmp,
  });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const servers: McpServer[] = [
  {
    name: "github",
    scope: "project",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_TOKEN: "token" },
  },
  {
    name: "linear",
    scope: "project",
    transport: "http",
    url: "https://mcp.linear.app/mcp",
    headers: { Authorization: "Bearer token" },
  },
  {
    name: "legacy",
    scope: "project",
    transport: "sse",
    url: "https://example.com/sse",
    headers: {},
  },
];

describe("CursorAdapter", () => {
  test("round-trips stdio, HTTP, and SSE servers", async () => {
    await adapter.write(servers, { scope: "project" });
    const result = await adapter.read("project");
    expect(result.warnings).toEqual([]);
    expect(result.servers).toEqual(servers);

    const raw = JSON.parse(fs.readFileSync(projectFile, "utf8"));
    expect(raw.mcpServers.linear.type).toBe("streamable-http");
  });

  test("preserves top-level settings, manual servers, and entry extensions", async () => {
    fs.mkdirSync(path.dirname(projectFile), { recursive: true });
    fs.writeFileSync(
      projectFile,
      JSON.stringify({
        custom: true,
        mcpServers: {
          github: { command: "old", disabled: true },
          manual: { command: "manual" },
        },
      }),
    );

    const result = await adapter.write([servers[0] as McpServer], {
      scope: "project",
    });
    const raw = JSON.parse(fs.readFileSync(projectFile, "utf8"));
    expect(result.backupPath).toBe(`${projectFile}.mcphq-backup`);
    expect(raw.custom).toBe(true);
    expect(raw.mcpServers.github.disabled).toBe(true);
    expect(raw.mcpServers.manual.command).toBe("manual");
  });

  test("dry run does not create a file", async () => {
    const result = await adapter.write(servers, {
      scope: "project",
      dryRun: true,
    });
    expect(result.written).toBe(false);
    expect(fs.existsSync(projectFile)).toBe(false);
  });

  test("remove deletes a server, preserves manual entries and unrelated keys", async () => {
    fs.mkdirSync(path.dirname(projectFile), { recursive: true });
    fs.writeFileSync(
      projectFile,
      JSON.stringify({
        custom: true,
        mcpServers: {
          github: { command: "npx" },
          manual: { command: "manual" },
        },
      }),
    );
    const result = await adapter.remove(["github"], { scope: "project" });
    expect(result.written).toBe(true);
    expect(result.changes).toEqual([{ server: "github", action: "remove" }]);

    const raw = JSON.parse(fs.readFileSync(projectFile, "utf8"));
    expect(raw.custom).toBe(true);
    expect(raw.mcpServers.github).toBeUndefined();
    expect(raw.mcpServers.manual.command).toBe("manual");
  });

  test("remove of a name that isn't present is a no-op", async () => {
    const result = await adapter.remove(["nope"], { scope: "project" });
    expect(result.written).toBe(false);
    expect(result.changes).toEqual([]);
    expect(fs.existsSync(projectFile)).toBe(false);
  });

  test("remove with dryRun reports the change without touching the file", async () => {
    await adapter.write([servers[0] as McpServer], { scope: "project" });
    const before = fs.readFileSync(projectFile, "utf8");
    const result = await adapter.remove(["github"], {
      scope: "project",
      dryRun: true,
    });
    expect(result.written).toBe(false);
    expect(result.changes).toEqual([{ server: "github", action: "remove" }]);
    expect(fs.readFileSync(projectFile, "utf8")).toBe(before);
  });
});
