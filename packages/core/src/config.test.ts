import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  CONFIG_FILE_NAME,
  ConfigError,
  defaultConfig,
  findProjectConfig,
  globalConfigPath,
  loadConfigFile,
  parseConfig,
  writeConfigFile,
} from "./config.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcphq-test-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("parseConfig", () => {
  test("parses a valid config", () => {
    const config = parseConfig(
      JSON.stringify({ servers: { github: { command: "npx" } } }),
      "mcp.config.json",
    );
    expect(Object.keys(config.servers)).toEqual(["github"]);
  });

  test("broken JSON produces a readable error, not a stack trace", () => {
    let error: unknown;
    try {
      parseConfig("{ servers: oops", "mcp.config.json");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as ConfigError).message;
    expect(message).toContain("mcp.config.json is not valid JSON");
    expect(message).toContain("mcphq init");
    expect(message).not.toContain("    at "); // no stack frames leaked into the message
  });

  test("schema violations name the offending server and field", () => {
    let error: unknown;
    try {
      parseConfig(
        JSON.stringify({ servers: { github: { url: 42 } } }),
        "mcp.config.json",
      );
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as ConfigError).message;
    expect(message).toContain("github");
    expect(message).toContain("url");
  });
});

describe("findProjectConfig", () => {
  test("finds a config in the starting directory", () => {
    const file = path.join(tmp, CONFIG_FILE_NAME);
    fs.writeFileSync(file, JSON.stringify({ servers: {} }));
    expect(findProjectConfig(tmp)).toBe(file);
  });

  test("walks up to a parent directory", () => {
    const file = path.join(tmp, CONFIG_FILE_NAME);
    fs.writeFileSync(file, JSON.stringify({ servers: {} }));
    const nested = path.join(tmp, "a", "b");
    fs.mkdirSync(nested, { recursive: true });
    expect(findProjectConfig(nested)).toBe(file);
  });

  test("returns null when no config exists", () => {
    expect(findProjectConfig(tmp)).toBeNull();
  });
});

describe("globalConfigPath", () => {
  test("ends with the config file name inside an mcphq directory", () => {
    const p = globalConfigPath();
    expect(path.basename(p)).toBe(CONFIG_FILE_NAME);
    expect(p).toContain("mcphq");
  });

  test("uses ~/.config/mcphq on macOS and Linux", () => {
    if (process.platform === "win32") return;
    const prev = process.env.XDG_CONFIG_HOME;
    try {
      delete process.env.XDG_CONFIG_HOME;
      expect(globalConfigPath()).toBe(
        path.join(os.homedir(), ".config", "mcphq", CONFIG_FILE_NAME),
      );
      process.env.XDG_CONFIG_HOME = "/custom/xdg";
      expect(globalConfigPath()).toBe(
        path.join("/custom/xdg", "mcphq", CONFIG_FILE_NAME),
      );
    } finally {
      if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prev;
    }
  });
});

describe("writeConfigFile + loadConfigFile", () => {
  test("round-trips the default config", () => {
    const file = path.join(tmp, "deep", "dir", CONFIG_FILE_NAME);
    writeConfigFile(file, defaultConfig());
    const loaded = loadConfigFile(file, "project");
    expect(loaded.config).toEqual({ servers: {} });
    expect(loaded.servers).toEqual([]);
    expect(loaded.scope).toBe("project");
  });

  test("refuses to overwrite without force", () => {
    const file = path.join(tmp, CONFIG_FILE_NAME);
    writeConfigFile(file, defaultConfig());
    expect(() => writeConfigFile(file, defaultConfig())).toThrow(ConfigError);
    expect(() =>
      writeConfigFile(file, defaultConfig(), { force: true }),
    ).not.toThrow();
  });

  test("loading a missing file says what to do next", () => {
    let error: unknown;
    try {
      loadConfigFile(path.join(tmp, "nope.json"), "project");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).message).toContain("mcphq init");
  });
});
