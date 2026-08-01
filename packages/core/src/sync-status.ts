import type { ClientAdapter } from "./adapters/types.js";
import type { LoadedConfig } from "./config.js";

export interface SyncStatus {
  /** Configured server name -> display names of clients it's actually synced to. */
  syncedTo: Map<string, string[]>;
  /** Human-readable adapter read warnings/errors, e.g. an entry mcphq couldn't parse. */
  warnings: string[];
}

/** Which detected clients each configured server is actually synced to. */
export async function computeSyncStatus(
  config: LoadedConfig,
  adapters: ClientAdapter[],
): Promise<SyncStatus> {
  const syncedTo = new Map<string, string[]>();
  for (const server of config.servers) syncedTo.set(server.name, []);

  const warnings: string[] = [];
  for (const adapter of adapters) {
    let servers: { name: string }[];
    try {
      const result = await adapter.read(config.scope);
      servers = result.servers;
      warnings.push(
        ...result.warnings.map((w) => `${adapter.displayName}: ${w}`),
      );
    } catch (err) {
      warnings.push(
        `${adapter.displayName}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    for (const server of servers) {
      syncedTo.get(server.name)?.push(adapter.displayName);
    }
  }

  return { syncedTo, warnings };
}
