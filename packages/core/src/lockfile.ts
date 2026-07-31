import * as crypto from "node:crypto";
import * as path from "node:path";
import { z } from "zod";
import {
  fromCanonical,
  type McpServer,
  SCOPES,
  type Scope,
  type ServerEntry,
  serverEntrySchema,
} from "./canonical.js";
import { ConfigError } from "./config.js";
import { readJsonFile, writeJsonFileSafe } from "./fs-safe.js";

export const LOCKFILE_NAME = "mcphq.lock.json";

/** One server's last-synced state for one client+scope. */
export interface LockfileEntry {
  hash: string;
  value: ServerEntry;
}

export interface LockFile {
  version: 1;
  /** clientName -> scope -> serverName -> last-synced entry */
  clients: Record<
    string,
    Partial<Record<Scope, Record<string, LockfileEntry>>>
  >;
}

const lockfileEntrySchema = z.object({
  hash: z.string(),
  value: serverEntrySchema,
});

const lockfileSchema = z.strictObject({
  version: z.literal(1),
  clients: z.record(
    z.string(),
    z
      .object(
        Object.fromEntries(
          SCOPES.map((s) => [s, z.record(z.string(), lockfileEntrySchema)]),
        ),
      )
      .partial(),
  ),
});

/** Deterministic JSON: object keys sorted recursively; array order preserved (it's meaningful, e.g. `args`). */
function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Content hash of the fields mcphq actually owns on this server (via
 * `fromCanonical`), canonicalized so key order/formatting never causes a
 * false-positive drift report. This is the one thing every adapter agrees on.
 */
export function hashServer(server: McpServer): string {
  const owned = { transport: server.transport, ...fromCanonical(server) };
  return crypto
    .createHash("sha256")
    .update(canonicalStringify(owned))
    .digest("hex");
}

/** Where the lockfile lives: next to whichever mcp.config.json is active. */
export function lockfilePathFor(configPath: string): string {
  return path.join(path.dirname(configPath), LOCKFILE_NAME);
}

/** Read the lockfile, or an empty one if it doesn't exist yet (first sync). */
export function readLockfile(filePath: string): LockFile {
  const raw = readJsonFile(filePath);
  if (raw === undefined) return { version: 1, clients: {} };
  const result = lockfileSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(
      filePath,
      `${filePath} is not a valid mcphq lockfile.\nDelete it and run \`mcphq sync\` to regenerate it — it is bookkeeping only, safe to delete.`,
    );
  }
  return result.data as LockFile;
}

/** Atomically write the lockfile (reuses the same backup+temp+rename safety as client configs). */
export function writeLockfile(filePath: string, lockfile: LockFile): void {
  writeJsonFileSafe(filePath, lockfile);
}

/** Record the current state of `servers` as "last synced" for one client+scope. */
export function updateLockfileEntries(
  lockfile: LockFile,
  clientName: string,
  scope: Scope,
  servers: McpServer[],
): LockFile {
  const client = { ...(lockfile.clients[clientName] ?? {}) };
  const existing = client[scope] ?? {};
  const updated = { ...existing };
  for (const server of servers) {
    updated[server.name] = {
      hash: hashServer(server),
      value: fromCanonical(server),
    };
  }
  client[scope] = updated;
  return {
    ...lockfile,
    clients: { ...lockfile.clients, [clientName]: client },
  };
}

/** Stop tracking the named servers for one client+scope (used by `remove`). */
export function removeLockfileEntries(
  lockfile: LockFile,
  clientName: string,
  scope: Scope,
  names: string[],
): LockFile {
  const client = { ...(lockfile.clients[clientName] ?? {}) };
  const existing = { ...(client[scope] ?? {}) };
  for (const name of names) delete existing[name];
  client[scope] = existing;
  return {
    ...lockfile,
    clients: { ...lockfile.clients, [clientName]: client },
  };
}
