import { describe, expect, test } from "bun:test";
import {
  buildServerEntry,
  pickInstallTarget,
  type RegistryServer,
  requiredInputs,
  templateVars,
} from "./registry.js";

function server(overrides: Partial<RegistryServer> = {}): RegistryServer {
  return {
    name: "example/server",
    packages: [],
    remotes: [],
    status: "active",
    ...overrides,
  };
}

describe("pickInstallTarget", () => {
  test("prefers an npm package over a remote", () => {
    const s = server({
      packages: [{ registryType: "npm", identifier: "example-mcp" }],
      remotes: [{ type: "streamable-http", url: "https://example.com/mcp" }],
    });
    const target = pickInstallTarget(s);
    expect(target.kind).toBe("package");
  });

  test("falls back to a remote when there's no supported package", () => {
    const s = server({
      remotes: [{ type: "streamable-http", url: "https://example.com/mcp" }],
    });
    expect(pickInstallTarget(s).kind).toBe("remote");
  });

  test("unsupported package registry type (e.g. pypi/oci) is reported, not silently dropped", () => {
    const s = server({
      packages: [{ registryType: "pypi", identifier: "example-mcp" }],
    });
    const target = pickInstallTarget(s);
    expect(target.kind).toBe("unsupported");
    if (target.kind === "unsupported") {
      expect(target.reason).toContain("pypi");
    }
  });

  test("no packages or remotes at all is unsupported", () => {
    expect(pickInstallTarget(server()).kind).toBe("unsupported");
  });
});

describe("templateVars", () => {
  test("extracts placeholder names from a header template", () => {
    expect(templateVars("Bearer {api_key}")).toEqual(["api_key"]);
    expect(templateVars("no placeholders here")).toEqual([]);
  });
});

describe("requiredInputs", () => {
  test("only required env vars are surfaced for a package target", () => {
    const s = server({
      packages: [
        {
          registryType: "npm",
          identifier: "example-mcp",
          environmentVariables: [
            { name: "REQUIRED_TOKEN", isRequired: true },
            { name: "OPTIONAL_FLAG", isRequired: false },
          ],
        },
      ],
    });
    const target = pickInstallTarget(s);
    const inputs = requiredInputs(target);
    expect(inputs.env.map((e) => e.name)).toEqual(["REQUIRED_TOKEN"]);
  });

  test("only required header placeholders are surfaced for a remote target", () => {
    const s = server({
      remotes: [
        {
          type: "streamable-http",
          url: "https://example.com/mcp",
          headers: [
            {
              name: "Authorization",
              isRequired: true,
              value: "Bearer {api_key}",
            },
            { name: "X-Optional", isRequired: false, value: "{unused}" },
          ],
        },
      ],
    });
    const target = pickInstallTarget(s);
    const inputs = requiredInputs(target);
    expect(inputs.headerVars).toEqual(["api_key"]);
  });
});

describe("buildServerEntry", () => {
  test("npm package becomes an npx stdio command with runtime args before the identifier", () => {
    const s = server({
      packages: [
        {
          registryType: "npm",
          identifier: "example-mcp",
          runtimeArguments: [{ value: "-y" }],
          environmentVariables: [{ name: "TOKEN", isRequired: true }],
        },
      ],
    });
    const target = pickInstallTarget(s);
    if (target.kind !== "package") throw new Error("expected package target");
    const entry = buildServerEntry(target, {
      env: { TOKEN: "secret" },
      headerVars: {},
    });
    expect(entry).toEqual({
      command: "npx",
      args: ["-y", "example-mcp"],
      env: { TOKEN: "secret" },
    });
  });

  test("remote with a templated auth header interpolates the user-supplied value", () => {
    const s = server({
      remotes: [
        {
          type: "streamable-http",
          url: "https://example.com/mcp",
          headers: [
            {
              name: "Authorization",
              isRequired: true,
              value: "Bearer {api_key}",
            },
          ],
        },
      ],
    });
    const target = pickInstallTarget(s);
    if (target.kind !== "remote") throw new Error("expected remote target");
    const entry = buildServerEntry(target, {
      env: {},
      headerVars: { api_key: "sk-123" },
    });
    expect(entry).toEqual({
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer sk-123" },
    });
  });

  test("sse remote sets transport: sse", () => {
    const s = server({
      remotes: [{ type: "sse", url: "https://example.com/sse" }],
    });
    const target = pickInstallTarget(s);
    if (target.kind !== "remote") throw new Error("expected remote target");
    const entry = buildServerEntry(target, { env: {}, headerVars: {} });
    expect(entry).toEqual({ url: "https://example.com/sse", transport: "sse" });
  });
});
