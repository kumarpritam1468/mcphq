import * as fs from "node:fs";
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

const clientEntrySchema = z
  .looseObject({
    type: z.enum(["stdio", "http", "sse", "streamable-http"]).optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .refine(
    (entry) => (entry.command !== undefined) !== (entry.url !== undefined),
    { message: 'entry must have exactly one of "command" or "url"' },
  );

type ClientEntry = z.infer<typeof clientEntrySchema>;

const OWNED_KEYS = [
  "type",
  "command",
  "args",
  "env",
  "url",
  "headers",
] as const;

export interface JsonMcpAdapterOptions {
  name: string;
  displayName: string;
  serverKey: "mcpServers" | "servers";
  locations: ConfigLocation[];
  detectionPaths: string[];
  remoteType: (transport: "http" | "sse") => string;
}

/** Shared implementation for clients whose MCP configuration is a JSON map. */
export class JsonMcpAdapter implements ClientAdapter {
  readonly name: string;
  readonly displayName: string;

  private readonly serverKey: "mcpServers" | "servers";
  private readonly locations: ConfigLocation[];
  private readonly detectionPaths: string[];
  private readonly remoteType: (transport: "http" | "sse") => string;

  constructor(options: JsonMcpAdapterOptions) {
    this.name = options.name;
    this.displayName = options.displayName;
    this.serverKey = options.serverKey;
    this.locations = options.locations;
    this.detectionPaths = options.detectionPaths;
    this.remoteType = options.remoteType;
  }

  async detect(): Promise<boolean> {
    return this.detectionPaths.some((candidate) => fs.existsSync(candidate));
  }

  getConfigPaths(): ConfigLocation[] {
    return [...this.locations];
  }

  async read(scope: Scope): Promise<ReadResult> {
    const filePath = this.pathFor(scope);
    const entries = this.readServersMap(filePath);
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
    const existing = this.readServersMap(filePath);
    const next: Record<string, unknown> = { ...existing };
    const changes: ServerChange[] = [];

    for (const server of servers) {
      const desired = this.toClientEntry(server);
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

    document[this.serverKey] = next;
    const backupPath = writeJsonFileSafe(filePath, document);
    return { path: filePath, changes, written: true, backupPath };
  }

  private pathFor(scope: Scope): string {
    const location = this.locations.find(
      (candidate) => candidate.scope === scope,
    );
    if (!location) {
      throw new Error(`${this.displayName} does not support ${scope} scope`);
    }
    return location.path;
  }

  private readServersMap(filePath: string): Record<string, unknown> {
    const document = readJsonFile(filePath);
    if (document === undefined || document === null) return {};
    const entries = (document as Record<string, unknown>)[this.serverKey];
    if (entries === undefined || entries === null) return {};
    if (typeof entries !== "object" || Array.isArray(entries)) return {};
    return entries as Record<string, unknown>;
  }

  private toClientEntry(server: McpServer): Record<string, unknown> {
    if (server.transport === "stdio") {
      return {
        type: "stdio",
        command: server.command,
        ...(server.args.length > 0 ? { args: server.args } : {}),
        ...(Object.keys(server.env).length > 0 ? { env: server.env } : {}),
      };
    }
    return {
      type: this.remoteType(server.transport),
      url: server.url,
      ...(Object.keys(server.headers).length > 0
        ? { headers: server.headers }
        : {}),
    };
  }
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
  const transport = entry.type === "sse" ? ("sse" as const) : ("http" as const);
  return {
    name,
    scope,
    transport,
    url: entry.url as string,
    headers: entry.headers ?? {},
  };
}

function mergeEntry(
  current: unknown,
  desired: Record<string, unknown>,
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
