import type { McpServer, Scope } from "../canonical.js";

/** A client config file location, per scope. */
export interface ConfigLocation {
  scope: Scope;
  path: string;
}

/** What happened (or would happen) to one server during a write. */
export type ChangeAction = "add" | "update" | "unchanged";

export interface ServerChange {
  server: string;
  action: ChangeAction;
  /** Human-readable field-level changes, e.g. `command: "npx a" → "npx b"`. Only set for updates. */
  details?: string[];
}

export interface WriteResult {
  /** The client config file involved. */
  path: string;
  changes: ServerChange[];
  /** False on dry runs or when there was nothing to change. */
  written: boolean;
  /** Where the pre-write backup landed; null when nothing was written or the file was new. */
  backupPath: string | null;
}

export interface ReadResult {
  servers: McpServer[];
  /** Entries that exist in the client file but could not be understood. Never fatal. */
  warnings: string[];
}

export interface WriteOptions {
  scope: Scope;
  /** Compute and return changes without touching the filesystem. */
  dryRun?: boolean;
}

/**
 * One adapter per AI client. Adding a client to mcphq = implementing this
 * interface in one new file. `write` must upsert: it only creates/updates
 * the servers it is given and must never remove or reshape anything else
 * in the client's config file.
 */
export interface ClientAdapter {
  /** Stable machine name, e.g. "claude-code". */
  readonly name: string;
  /** What users see, e.g. "Claude Code". */
  readonly displayName: string;
  /** Is this client present on this machine? */
  detect(): Promise<boolean>;
  /** Config file location for every scope this client supports. */
  getConfigPaths(): ConfigLocation[];
  /** Parse the client's config at `scope` into canonical servers. */
  read(scope: Scope): Promise<ReadResult>;
  /** Upsert the given servers into the client's config at `options.scope`. */
  write(servers: McpServer[], options: WriteOptions): Promise<WriteResult>;
}
