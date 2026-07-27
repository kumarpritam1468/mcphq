import { describe, expect, test } from "bun:test";
import {
  configFileSchema,
  serverEntrySchema,
  toCanonical,
} from "./canonical.js";

describe("serverEntrySchema", () => {
  test("accepts a minimal stdio server", () => {
    const result = serverEntrySchema.safeParse({ command: "npx" });
    expect(result.success).toBe(true);
  });

  test("accepts a full stdio server", () => {
    const result = serverEntrySchema.safeParse({
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: "abc" },
    });
    expect(result.success).toBe(true);
  });

  test("accepts a remote server with url and headers", () => {
    const result = serverEntrySchema.safeParse({
      url: "https://mcp.example.com/sse",
      transport: "sse",
      headers: { Authorization: "Bearer x" },
    });
    expect(result.success).toBe(true);
  });

  test("rejects an entry with neither command nor url", () => {
    const result = serverEntrySchema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('either "command"');
  });

  test("rejects an entry with both command and url", () => {
    const result = serverEntrySchema.safeParse({
      command: "npx",
      url: "https://mcp.example.com",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("never both");
  });

  test("rejects stdio transport on a remote server", () => {
    const result = serverEntrySchema.safeParse({
      url: "https://mcp.example.com",
      transport: "stdio",
    });
    expect(result.success).toBe(false);
  });

  test("rejects http transport on a command server", () => {
    const result = serverEntrySchema.safeParse({
      command: "npx",
      transport: "http",
    });
    expect(result.success).toBe(false);
  });

  test("rejects args/env on a remote server", () => {
    const result = serverEntrySchema.safeParse({
      url: "https://mcp.example.com",
      args: ["--foo"],
    });
    expect(result.success).toBe(false);
  });

  test("rejects an invalid url", () => {
    const result = serverEntrySchema.safeParse({ url: "not a url" });
    expect(result.success).toBe(false);
  });

  test("rejects unknown keys", () => {
    const result = serverEntrySchema.safeParse({ command: "npx", cmd: "oops" });
    expect(result.success).toBe(false);
  });
});

describe("configFileSchema", () => {
  test("accepts an empty servers map", () => {
    expect(configFileSchema.safeParse({ servers: {} }).success).toBe(true);
  });

  test("accepts $schema alongside servers", () => {
    const result = configFileSchema.safeParse({
      $schema: "https://example.com/schema.json",
      servers: { github: { command: "npx" } },
    });
    expect(result.success).toBe(true);
  });

  test("rejects a missing servers key", () => {
    expect(configFileSchema.safeParse({}).success).toBe(false);
  });

  test("rejects invalid server names", () => {
    expect(
      configFileSchema.safeParse({
        servers: { "bad name!": { command: "npx" } },
      }).success,
    ).toBe(false);
    expect(
      configFileSchema.safeParse({
        servers: { "-leading": { command: "npx" } },
      }).success,
    ).toBe(false);
  });

  test("rejects top-level unknown keys", () => {
    expect(
      configFileSchema.safeParse({ servers: {}, extra: true }).success,
    ).toBe(false);
  });
});

describe("toCanonical", () => {
  test("expands stdio and remote entries with defaults filled in", () => {
    const config = configFileSchema.parse({
      servers: {
        github: { command: "npx", args: ["-y", "server-github"] },
        linear: { url: "https://mcp.linear.app/sse", transport: "sse" },
        api: { url: "https://mcp.example.com" },
      },
    });
    const servers = toCanonical(config, "project");
    expect(servers).toEqual([
      {
        name: "github",
        scope: "project",
        transport: "stdio",
        command: "npx",
        args: ["-y", "server-github"],
        env: {},
      },
      {
        name: "linear",
        scope: "project",
        transport: "sse",
        url: "https://mcp.linear.app/sse",
        headers: {},
      },
      {
        name: "api",
        scope: "project",
        transport: "http",
        url: "https://mcp.example.com",
        headers: {},
      },
    ]);
  });
});
