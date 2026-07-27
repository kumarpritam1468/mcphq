import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import envPaths from "env-paths";
import { z } from "zod";
import {
  type ConfigFile,
  configFileSchema,
  type McpServer,
  type Scope,
  toCanonical,
} from "./canonical.js";

export const CONFIG_FILE_NAME = "mcp.config.json";

/**
 * A user-facing configuration failure. `message` is always safe to print
 * as-is: no stack traces, and it says what to do next.
 */
export class ConfigError extends Error {
  readonly file: string;

  constructor(file: string, message: string) {
    super(message);
    this.name = "ConfigError";
    this.file = file;
  }
}

export interface LoadedConfig {
  path: string;
  scope: Scope;
  config: ConfigFile;
  servers: McpServer[];
}

/**
 * Global config directory: ~/.config/mcphq (XDG-style) on macOS and Linux —
 * one predictable, documentable path for the dev audience — and the native
 * %APPDATA% location on Windows, where ~/.config would be alien.
 */
export function globalConfigDir(): string {
  if (process.platform === "win32") {
    return envPaths("mcphq", { suffix: "" }).config;
  }
  const xdgConfigHome =
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(xdgConfigHome, "mcphq");
}

/** Full path to the global mcp.config.json. */
export function globalConfigPath(): string {
  return path.join(globalConfigDir(), CONFIG_FILE_NAME);
}

/**
 * Walk from `startDir` up to the filesystem root looking for mcp.config.json,
 * so mcphq works from any subdirectory of a project.
 */
export function findProjectConfig(
  startDir: string = process.cwd(),
): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, CONFIG_FILE_NAME);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve which config file to use: project config if one exists in or above
 * `startDir`, otherwise the global config, otherwise null.
 */
export function resolveConfigPath(
  startDir: string = process.cwd(),
): { path: string; scope: Scope } | null {
  const project = findProjectConfig(startDir);
  if (project) return { path: project, scope: "project" };
  const global = globalConfigPath();
  if (fs.existsSync(global)) return { path: global, scope: "global" };
  return null;
}

/** Parse and validate raw JSON text as a config file. Throws ConfigError with a readable message. */
export function parseConfig(raw: string, file: string): ConfigFile {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ConfigError(
      file,
      `${file} is not valid JSON.\n  ${detail}\nFix the syntax error, or delete the file and run \`mcphq init\` to start over.`,
    );
  }

  const result = configFileSchema.safeParse(data);
  if (!result.success) {
    const issues = z.prettifyError(result.error);
    throw new ConfigError(
      file,
      `${file} is not a valid mcphq config:\n${indent(issues)}\nEdit the file to fix the fields above, or run \`mcphq init --force\` to recreate it.`,
    );
  }
  return result.data;
}

/** Load, parse, and validate a config file from disk. */
export function loadConfigFile(filePath: string, scope: Scope): LoadedConfig {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    throw new ConfigError(
      filePath,
      `Could not read ${filePath}. Run \`mcphq init\` to create a config.`,
    );
  }
  const config = parseConfig(raw, filePath);
  return { path: filePath, scope, config, servers: toCanonical(config, scope) };
}

/**
 * Load the active config (project first, then global). Returns null when no
 * config exists anywhere — callers decide whether that is an error.
 */
export function loadConfig(
  startDir: string = process.cwd(),
): LoadedConfig | null {
  const resolved = resolveConfigPath(startDir);
  if (!resolved) return null;
  return loadConfigFile(resolved.path, resolved.scope);
}

/** The config `mcphq init --no-input` writes. */
export function defaultConfig(): ConfigFile {
  return { servers: {} };
}

/**
 * Write a config file, creating parent directories as needed. Refuses to
 * overwrite an existing file unless `force` is set.
 */
export function writeConfigFile(
  filePath: string,
  config: ConfigFile,
  opts: { force?: boolean } = {},
): void {
  const validated = configFileSchema.parse(config);
  if (!opts.force && fs.existsSync(filePath)) {
    throw new ConfigError(
      filePath,
      `${filePath} already exists. Pass --force to overwrite it.`,
    );
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}
