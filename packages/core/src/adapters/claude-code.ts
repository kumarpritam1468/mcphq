import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer, Scope } from "../canonical.js";
import { readJsonFile, writeJsonFileSafe } from "../fs-safe.js";
import type {
  ClientAdapter,
  ConfigLocation,
  ReadResult,
  ServerChange,
  WriteOptions,
  WriteResult,
} from "./types.js";

/**
 * Claude Code stores MCP servers in two places mcphq writes to
 * (documented in CONFIG_LOCATIONS.md):
 *
 * - user/global scope: `~/.claude.json`, top-level `mcpServers` key. This
 *   file also holds a large amount of unrelated Claude Code state, so we
 *   only ever touch the `mcpServers` key inside it.
 * - project scope: `<project>/.mcp.json`, `{ "mcpServers": { ... } }`.
 *
 * Entry shape: `{ type?: "stdio" | "http" | "sse", command?, args?, env?,
 * url?, headers? }` — `type` is optional for stdio entries.
 */

const clientEntrySchema = z
  .looseObject({
    type: z.enum(["stdio", "http", "sse"]).optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .refine((e) => e.command !== undefined || e.url !== undefined, {
    message: 'entry has neither "command" nor "url"',
  });

type ClientEntry = z.infer<typeof clientEntrySchema>;

/** The entry fields mcphq owns; anything else a user added by hand is preserved on update. */
const OWNED_KEYS = [
  "type",
  "command",
  "args",
  "env",
  "url",
  "headers",
] as const;

export interface ClaudeCodeAdapterOptions {
  /** Project root for `.mcp.json`. Defaults to cwd. */
  projectDir?: string;
  /** Override of `~/.claude.json`, for tests. */
  globalConfigPath?: string;
}

export class ClaudeCodeAdapter implements ClientAdapter {
  readonly name = "claude-code";
  readonly displayName = "Claude Code";

  private readonly projectDir: string;
  private readonly globalPath: string;

  constructor(options: ClaudeCodeAdapterOptions = {}) {
    this.projectDir = options.projectDir ?? process.cwd();
    this.globalPath =
      options.globalConfigPath ?? path.join(os.homedir(), ".claude.json");
  }

  async detect(): Promise<boolean> {
    return (
      fs.existsSync(this.globalPath) ||
      fs.existsSync(path.join(os.homedir(), ".claude"))
    );
  }

  getConfigPaths(): ConfigLocation[] {
    return [
      { scope: "global", path: this.globalPath },
      { scope: "project", path: path.join(this.projectDir, ".mcp.json") },
    ];
  }

  private pathFor(scope: Scope): string {
    const location = this.getConfigPaths().find((l) => l.scope === scope);
    // both scopes are always present in getConfigPaths()
    return (location as ConfigLocation).path;
  }

  async read(scope: Scope): Promise<ReadResult> {
    const filePath = this.pathFor(scope);
    const entries = readServersMap(filePath);
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
    const document = (readJsonFile(filePath) ?? {}) as Record<string, unknown>;
    const existing = readServersMap(filePath);

    const changes: ServerChange[] = [];
    const next: Record<string, unknown> = { ...existing };

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
        continue;
      }
      changes.push({ server: server.name, action: "update", details });
      next[server.name] = merged;
    }

    const hasChanges = changes.some((c) => c.action !== "unchanged");
    if (options.dryRun || !hasChanges) {
      return { path: filePath, changes, written: false, backupPath: null };
    }

    document.mcpServers = next;
    const backupPath = writeJsonFileSafe(filePath, document);
    return { path: filePath, changes, written: true, backupPath };
  }

  async remove(
    names: string[],
    options: WriteOptions,
  ): Promise<WriteResult> {
    const filePath = this.pathFor(options.scope);
    const document = (readJsonFile(filePath) ?? {}) as Record<string, unknown>;
    const existing = readServersMap(filePath);
    const next: Record<string, unknown> = { ...existing };
    const changes: ServerChange[] = [];

    for (const name of names) {
      if (existing[name] === undefined) continue;
      changes.push({ server: name, action: "remove" });
      delete next[name];
    }

    if (options.dryRun || changes.length === 0) {
      return { path: filePath, changes, written: false, backupPath: null };
    }

    document.mcpServers = next;
    const backupPath = writeJsonFileSafe(filePath, document);
    return { path: filePath, changes, written: true, backupPath };
  }
}

/** Extract the mcpServers map from a client file, tolerating absence. */
function readServersMap(filePath: string): Record<string, unknown> {
  const document = readJsonFile(filePath);
  if (document === undefined || document === null) return {};
  const servers = (document as Record<string, unknown>).mcpServers;
  if (servers === undefined || servers === null) return {};
  if (typeof servers !== "object" || Array.isArray(servers)) return {};
  return servers as Record<string, unknown>;
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
    transport: entry.type === "sse" ? "sse" : "http",
    url: entry.url as string,
    headers: entry.headers ?? {},
  };
}

function toClientEntry(server: McpServer): ClientEntry {
  if (server.transport === "stdio") {
    return {
      type: "stdio",
      command: server.command,
      ...(server.args.length > 0 ? { args: server.args } : {}),
      ...(Object.keys(server.env).length > 0 ? { env: server.env } : {}),
    };
  }
  return {
    type: server.transport,
    url: server.url,
    ...(Object.keys(server.headers).length > 0
      ? { headers: server.headers }
      : {}),
  };
}

/** Replace the fields mcphq owns, preserve anything the user added by hand. */
function mergeEntry(
  current: unknown,
  desired: ClientEntry,
): Record<string, unknown> {
  const preserved: Record<string, unknown> = {};
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

/** Field-level description of what an update changes, for dry-run output. */
function describeFieldChanges(
  current: unknown,
  merged: Record<string, unknown>,
): string[] {
  const before = (
    current !== null && typeof current === "object" ? current : {}
  ) as Record<string, unknown>;
  const details: string[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(merged)]);
  for (const key of keys) {
    const oldValue = JSON.stringify(before[key]);
    const newValue = JSON.stringify(merged[key]);
    if (oldValue === newValue) continue;
    if (oldValue === undefined) details.push(`${key}: ${newValue} (added)`);
    else if (newValue === undefined) details.push(`${key}: removed`);
    else details.push(`${key}: ${oldValue} → ${newValue}`);
  }
  return details;
}
