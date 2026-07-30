import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse } from "smol-toml";
import type { McpServer } from "../canonical.js";
import { ConfigError } from "../config.js";
import { CodexAdapter } from "./codex.js";

let tmp: string;
let adapter: CodexAdapter;
let projectFile: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcphq-codex-"));
  const projectDir = path.join(tmp, "project");
  projectFile = path.join(projectDir, ".codex", "config.toml");
  adapter = new CodexAdapter({
    projectDir,
    globalConfigPath: path.join(tmp, "global", "config.toml"),
    homeDir: tmp,
  });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const servers: McpServer[] = [
  {
    name: "context7",
    scope: "project",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    env: { LOCAL_TOKEN: "token" },
  },
  {
    name: "figma.remote",
    scope: "project",
    transport: "http",
    url: "https://mcp.figma.com/mcp",
    headers: { "X-Figma-Region": "us-east-1" },
  },
];

describe("CodexAdapter", () => {
  test("round-trips supported stdio and Streamable HTTP servers", async () => {
    await adapter.write(servers, { scope: "project" });
    const result = await adapter.read("project");
    expect(result.warnings).toEqual([]);
    expect(result.servers).toEqual(servers);

    const raw = parse(fs.readFileSync(projectFile, "utf8"));
    const entries = raw.mcp_servers as Record<string, Record<string, unknown>>;
    expect(entries["figma.remote"]?.http_headers).toEqual({
      "X-Figma-Region": "us-east-1",
    });
  });

  test("preserves unrelated config, manual servers, and server policy", async () => {
    fs.mkdirSync(path.dirname(projectFile), { recursive: true });
    fs.writeFileSync(
      projectFile,
      [
        'model = "gpt-test"',
        "",
        "[features]",
        "goals = true",
        "",
        "[mcp_servers.context7]",
        'command = "old"',
        "enabled = false",
        "",
        "[mcp_servers.manual]",
        'command = "manual"',
        "",
      ].join("\n"),
    );

    const result = await adapter.write([servers[0] as McpServer], {
      scope: "project",
    });
    const raw = parse(fs.readFileSync(projectFile, "utf8"));
    const entries = raw.mcp_servers as Record<string, Record<string, unknown>>;
    expect(result.backupPath).toBe(`${projectFile}.mcphq-backup`);
    expect(raw.model).toBe("gpt-test");
    expect(raw.features).toEqual({ goals: true });
    expect(entries.context7?.enabled).toBe(false);
    expect(entries.manual?.command).toBe("manual");
  });

  test("dry run reports changes without touching the file", async () => {
    const result = await adapter.write(servers, {
      scope: "project",
      dryRun: true,
    });
    expect(result.changes.every((change) => change.action === "add")).toBe(
      true,
    );
    expect(fs.existsSync(projectFile)).toBe(false);
  });

  test("invalid TOML is a readable error and is never overwritten", async () => {
    fs.mkdirSync(path.dirname(projectFile), { recursive: true });
    fs.writeFileSync(projectFile, "[broken\n");
    await expect(
      adapter.write(servers, { scope: "project" }),
    ).rejects.toBeInstanceOf(ConfigError);
    expect(fs.readFileSync(projectFile, "utf8")).toBe("[broken\n");
  });
});
