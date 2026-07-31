import type { McpServer, Scope, ServerEntry } from "./canonical.js";
import { fromCanonical } from "./canonical.js";
import { hashServer, type LockFile } from "./lockfile.js";

export type DriftStatus = "modified" | "removed";

export interface DriftEntry {
  server: string;
  status: DriftStatus;
  /** What mcphq last wrote (owned fields only). */
  lastSynced: ServerEntry;
  /** What's actually there now; undefined when the server is gone. */
  current: ServerEntry | undefined;
}

/**
 * Compare one client+scope's current servers against what mcphq last synced
 * there. Only reports on servers mcphq actually tracks (synced at least
 * once) — a hand-added server the config never knew about is not drift.
 */
export function computeDrift(
  lockfile: LockFile,
  clientName: string,
  scope: Scope,
  currentServers: McpServer[],
): DriftEntry[] {
  const tracked = lockfile.clients[clientName]?.[scope] ?? {};
  const currentByName = new Map(currentServers.map((s) => [s.name, s]));
  const entries: DriftEntry[] = [];

  for (const [name, entry] of Object.entries(tracked)) {
    const current = currentByName.get(name);
    if (!current) {
      entries.push({
        server: name,
        status: "removed",
        lastSynced: entry.value,
        current: undefined,
      });
      continue;
    }
    if (hashServer(current) !== entry.hash) {
      entries.push({
        server: name,
        status: "modified",
        lastSynced: entry.value,
        current: fromCanonical(current),
      });
    }
  }
  return entries;
}
