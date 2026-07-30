import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse, stringify, type TomlTable } from "smol-toml";
import { z } from "zod";
import type { McpServer, Scope } from "../canonical.js";
import { ConfigError } from "../config.js";
import { writeTextFileSafe } from "../fs-safe.js";
import type {
  ClientAdapter,
  ConfigLocation,
  ReadResult,
  ServerChange,
  WriteOptions,
  WriteResult,
} from "./types.js";

const clientEntrySchema = z
  .looseObject({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().optional(),
    http_headers: z.record(z.string(), z.string()).optional(),
  })
  .refine(
    (entry) => (entry.command !== undefined) !== (entry.url !== undefined),
    { message: 'entry must have exactly one of "command" or "url"' },
  );

type ClientEntry = z.infer<typeof clientEntrySchema>;

const OWNED_KEYS = ["command", "args", "env", "url", "http_headers"] as const;

export interface CodexAdapterOptions {
  projectDir?: string;
  globalConfigPath?: string;
  homeDir?: string;
}

export class CodexAdapter implements ClientAdapter {
  readonly name = "codex";
  readonly displayName = "Codex";

  private readonly projectDir: string;
  private readonly globalPath: string;
  private readonly homeDir: string;

  constructor(options: CodexAdapterOptions = {}) {
    this.homeDir = options.homeDir ?? os.homedir();
    this.projectDir = options.projectDir ?? process.cwd();
    this.globalPath =
      options.globalConfigPath ??
      path.join(this.homeDir, ".codex", "config.toml");
  }

  async detect(): Promise<boolean> {
    return (
      fs.existsSync(this.globalPath) ||
      fs.existsSync(path.join(this.homeDir, ".codex")) ||
      fs.existsSync(path.join(this.projectDir, ".codex"))
    );
  }

  getConfigPaths(): ConfigLocation[] {
    return [
      { scope: "global", path: this.globalPath },
      {
        scope: "project",
        path: path.join(this.projectDir, ".codex", "config.toml"),
      },
    ];
  }

  async read(scope: Scope): Promise<ReadResult> {
    const filePath = this.pathFor(scope);
    const document = readTomlFile(filePath);
    const entries = readServersTable(document);
    const servers: McpServer[] = [];
    const warnings: string[] = [];

    for (const [name, raw] of Object.entries(entries)) {
      const parsed = clientEntrySchema.safeParse(raw);
      if (!parsed.success) {
        warnings.push(
          `${filePath}: skipping server "${name}": ${parsed.error.issues[0]?.message ?? "unrecognized shape"}`,
        );
        continue;
      }
      servers.push(toCanonicalEntry(name, parsed.data, scope));
    }
    return { servers, warnings };
  }

  async write(
    servers: McpServer[],
    options: WriteOptions,
  ): Promise<WriteResult> {
    const filePath = this.pathFor(options.scope);
    const document = readTomlFile(filePath);
    const existing = readServersTable(document);
    const next: TomlTable = { ...existing };
    const changes: ServerChange[] = [];

    for (const server of servers) {
      const desired = toClientEntry(server);
      const current = existing[server.name];
      if (current === undefined) {
        changes.push({ server: server.name, action: "add" });
        next[server.name] = desired;
        continue;
      }
      const merged = mergeEntry(current, desired);
      const details = describeFieldChanges(current, merged);
      if (details.length === 0) {
        changes.push({ server: server.name, action: "unchanged" });
      } else {
        changes.push({ server: server.name, action: "update", details });
        next[server.name] = merged;
      }
    }

    const hasChanges = changes.some((change) => change.action !== "unchanged");
    if (options.dryRun || !hasChanges) {
      return { path: filePath, changes, written: false, backupPath: null };
    }

    document.mcp_servers = next;
    const serialized = `${stringify(document).trimEnd()}\n`;
    const backupPath = writeTextFileSafe(filePath, serialized, (raw) => {
      parse(raw);
    });
    return { path: filePath, changes, written: true, backupPath };
  }

  private pathFor(scope: Scope): string {
    const location = this.getConfigPaths().find(
      (candidate) => candidate.scope === scope,
    );
    return (location as ConfigLocation).path;
  }
}

function readTomlFile(filePath: string): TomlTable {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new ConfigError(
      filePath,
      `Could not read ${filePath}: ${(error as Error).message}`,
    );
  }
  try {
    return parse(raw);
  } catch (error) {
    throw new ConfigError(
      filePath,
      `${filePath} contains invalid TOML and mcphq will not touch it.\n  ${(error as Error).message}\nFix or remove the file, then re-run.`,
    );
  }
}

function readServersTable(document: TomlTable): TomlTable {
  const servers = document.mcp_servers;
  if (servers === undefined || servers === null) return {};
  if (typeof servers !== "object" || Array.isArray(servers)) return {};
  return servers as TomlTable;
}

function toCanonicalEntry(
  name: string,
  entry: ClientEntry,
  scope: Scope,
): McpServer {
  if (entry.command !== undefined) {
    return {
      name,
      scope,
      transport: "stdio",
      command: entry.command,
      args: entry.args ?? [],
      env: entry.env ?? {},
    };
  }
  return {
    name,
    scope,
    transport: "http",
    url: entry.url as string,
    headers: entry.http_headers ?? {},
  };
}

function toClientEntry(server: McpServer): TomlTable {
  if (server.transport === "stdio") {
    return {
      command: server.command,
      ...(server.args.length > 0 ? { args: server.args } : {}),
      ...(Object.keys(server.env).length > 0 ? { env: server.env } : {}),
    };
  }
  return {
    url: server.url,
    ...(Object.keys(server.headers).length > 0
      ? { http_headers: server.headers }
      : {}),
  };
}

function mergeEntry(current: unknown, desired: TomlTable): TomlTable {
  const preserved: TomlTable = {};
  if (
    current !== null &&
    typeof current === "object" &&
    !Array.isArray(current)
  ) {
    for (const [key, value] of Object.entries(current)) {
      if (!(OWNED_KEYS as readonly string[]).includes(key))
        preserved[key] = value;
    }
  }
  return { ...preserved, ...desired };
}

function describeFieldChanges(current: unknown, merged: TomlTable): string[] {
  const before = (
    current !== null && typeof current === "object" ? current : {}
  ) as TomlTable;
  const details: string[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(merged)]);
  for (const key of keys) {
    const oldValue = formatValue(before[key]);
    const newValue = formatValue(merged[key]);
    if (oldValue === newValue) continue;
    if (oldValue === undefined) details.push(`${key}: ${newValue} (added)`);
    else if (newValue === undefined) details.push(`${key}: removed`);
    else details.push(`${key}: ${oldValue} → ${newValue}`);
  }
  return details;
}

function formatValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? item.toString() : item,
  );
}
