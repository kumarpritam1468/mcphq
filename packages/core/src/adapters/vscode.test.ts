import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { McpServer } from "../canonical.js";
import { VsCodeAdapter, vsCodeUserDir } from "./vscode.js";

let tmp: string;
let adapter: VsCodeAdapter;
let projectFile: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcphq-vscode-"));
  const projectDir = path.join(tmp, "project");
  projectFile = path.join(projectDir, ".vscode", "mcp.json");
  adapter = new VsCodeAdapter({
    projectDir,
    globalConfigPath: path.join(tmp, "user", "mcp.json"),
    homeDir: tmp,
  });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const servers: McpServer[] = [
  {
    name: "filesystem",
    scope: "project",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
    env: {},
  },
  {
    name: "github",
    scope: "project",
    transport: "http",
    url: "https://api.githubcopilot.com/mcp",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: VS Code input-variable syntax
    headers: { Authorization: "Bearer ${input:github-token}" },
  },
  {
    name: "legacy",
    scope: "project",
    transport: "sse",
    url: "https://example.com/sse",
    headers: {},
  },
];

describe("VsCodeAdapter", () => {
  test("round-trips every supported transport", async () => {
    await adapter.write(servers, { scope: "project" });
    const result = await adapter.read("project");
    expect(result.warnings).toEqual([]);
    expect(result.servers).toEqual(servers);

    const raw = JSON.parse(fs.readFileSync(projectFile, "utf8"));
    expect(raw.servers.github.type).toBe("http");
  });

  test("preserves inputs, sandbox settings, and client-only entry fields", async () => {
    fs.mkdirSync(path.dirname(projectFile), { recursive: true });
    fs.writeFileSync(
      projectFile,
      JSON.stringify({
        inputs: [{ type: "promptString", id: "token" }],
        sandbox: { network: { allowedDomains: ["example.com"] } },
        servers: {
          // biome-ignore lint/suspicious/noTemplateCurlyInString: VS Code predefined-variable syntax
          filesystem: { command: "old", cwd: "${workspaceFolder}" },
          manual: { command: "manual" },
        },
      }),
    );

    await adapter.write([servers[0] as McpServer], { scope: "project" });
    const raw = JSON.parse(fs.readFileSync(projectFile, "utf8"));
    expect(raw.inputs).toHaveLength(1);
    expect(raw.sandbox.network.allowedDomains).toEqual(["example.com"]);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: VS Code predefined-variable syntax
    expect(raw.servers.filesystem.cwd).toBe("${workspaceFolder}");
    expect(raw.servers.manual.command).toBe("manual");
  });

  test("resolves default user profile paths on every OS", () => {
    expect(vsCodeUserDir("/home/dev", "linux", {})).toBe(
      "/home/dev/.config/Code/User",
    );
    expect(vsCodeUserDir("/Users/dev", "darwin", {})).toBe(
      "/Users/dev/Library/Application Support/Code/User",
    );
    expect(
      vsCodeUserDir("C:\\Users\\dev", "win32", { APPDATA: "D:\\Roaming" }),
    ).toBe(path.join("D:\\Roaming", "Code", "User"));
  });
});
