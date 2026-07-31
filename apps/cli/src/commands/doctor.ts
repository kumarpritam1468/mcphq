import * as path from "node:path";
import { isCancel, select } from "@clack/prompts";
import {
  type ClientAdapter,
  ConfigError,
  type ConfigFile,
  computeDrift,
  configFileSchema,
  type DriftEntry,
  getDetectedAdapters,
  type LoadedConfig,
  type LockFile,
  loadConfig,
  lockfilePathFor,
  type McpServer,
  readLockfile,
  removeLockfileEntries,
  type Scope,
  type ServerEntry,
  toCanonical,
  updateLockfileEntries,
  writeConfigFile,
  writeLockfile,
} from "@mcphq/core";
import type { Command } from "commander";
import pc from "picocolors";

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("check every synced client for drift since the last sync")
    .action(async () => {
      try {
        await runDoctor();
      } catch (err) {
        if (err instanceof ConfigError) {
          console.error(pc.red(err.message));
          process.exitCode = 1;
          return;
        }
        throw err;
      }
    });
}

async function runDoctor(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.error(
      pc.red(`No mcp.config.json found. Run ${pc.bold("mcphq init")} first.`),
    );
    process.exitCode = 1;
    return;
  }

  const lockfilePath = lockfilePathFor(config.path);
  let lockfile = readLockfile(lockfilePath);
  const adapters = await getDetectedAdapters({
    projectDir: path.dirname(config.path),
  });

  let foundDrift = false;
  for (const adapter of adapters) {
    const current = await adapter.read(config.scope);
    const drift = computeDrift(
      lockfile,
      adapter.name,
      config.scope,
      current.servers,
    );
    if (drift.length === 0) continue;

    foundDrift = true;
    console.log(`\n${pc.bold(adapter.displayName)}`);
    for (const entry of drift) {
      lockfile = await reconcile(entry, adapter, config, lockfile);
      // Persist after every reconciliation, not just at the end of the run —
      // a later write/reconcile failure must not lose already-applied progress.
      writeLockfile(lockfilePath, lockfile);
    }
  }

  if (!foundDrift) {
    console.log(
      pc.green(
        "No drift detected — every synced client matches mcp.config.json.",
      ),
    );
  }
}

async function reconcile(
  entry: DriftEntry,
  adapter: ClientAdapter,
  config: LoadedConfig,
  lockfile: LockFile,
): Promise<LockFile> {
  console.log(
    `  ${pc.yellow(entry.status === "removed" ? "-" : "~")} ${entry.server}`,
  );
  for (const detail of diffEntry(entry.lastSynced, entry.current)) {
    console.log(pc.dim(`      ${detail}`));
  }

  const choice = await select({
    message: `${entry.server}: keep the hand-edit, or restore what mcp.config.json says?`,
    options:
      entry.status === "removed"
        ? [
            {
              value: "keep-mine",
              label: "restore it (re-sync from mcp.config.json)",
            },
            {
              value: "keep-theirs",
              label: "remove it from mcp.config.json too",
            },
            { value: "skip", label: "leave as-is for now" },
          ]
        : [
            {
              value: "keep-theirs",
              label: "keep the hand-edit (pull it into mcp.config.json)",
            },
            {
              value: "keep-mine",
              label: "overwrite back to mcp.config.json's version",
            },
            { value: "skip", label: "leave as-is for now" },
          ],
  });
  if (isCancel(choice) || choice === "skip") return lockfile;

  if (choice === "keep-mine") {
    const server = config.servers.find((s) => s.name === entry.server);
    if (server) await adapter.write([server], { scope: config.scope });
    const refreshed = await adapter.read(config.scope);
    const refreshedServer = refreshed.servers.find(
      (s) => s.name === entry.server,
    );
    if (refreshedServer) {
      lockfile = updateLockfileEntries(lockfile, adapter.name, config.scope, [
        refreshedServer,
      ]);
    }
    return lockfile;
  }

  // keep-theirs: pull the client's value (or removal) into mcp.config.json
  const updatedConfigFile = applyKeepTheirs(config.config, entry);
  writeConfigFile(config.path, updatedConfigFile, { force: true });
  // Mutate the shared LoadedConfig in place: this same object is reused across
  // every reconcile() call in the run, so later calls (keep-theirs rebuilding
  // `servers` from config.config, or keep-mine reading config.servers) must
  // see this edit — otherwise a second decision in the same run overwrites it.
  config.config = updatedConfigFile;
  config.servers = toCanonical(updatedConfigFile, config.scope);

  // The client file is now the source of truth for this server/adapter —
  // re-read it and sync the lockfile to match, otherwise this exact drift
  // gets re-reported on every future `doctor` run (and for "removed", the
  // lockfile would track a server that no longer exists anywhere, forever).
  const refreshed = await adapter.read(config.scope);
  const refreshedServer = refreshed.servers.find(
    (s) => s.name === entry.server,
  );
  lockfile = updateLockfileAfterKeepTheirs(
    lockfile,
    adapter.name,
    config.scope,
    entry.server,
    refreshedServer,
  );

  console.log(
    pc.dim(
      entry.status === "removed"
        ? `      Updated ${config.path} — ${entry.server} is no longer tracked for ${adapter.displayName}. If it's still synced to other clients, remove it there by hand.`
        : `      Updated ${config.path}. Run ${pc.bold("mcphq sync")} to propagate this to your other clients.`,
    ),
  );
  return lockfile;
}

/**
 * Compute the config file that results from accepting the client's value for
 * one drifted server ("keep-theirs"). Pure so it can be chained: the caller
 * must feed each call's output back in as the next call's input when
 * reconciling multiple servers in one run — otherwise a later decision
 * overwrites an earlier one instead of accumulating.
 */
export function applyKeepTheirs(
  configFile: ConfigFile,
  entry: Pick<DriftEntry, "server" | "status" | "current">,
): ConfigFile {
  const servers = { ...configFile.servers };
  if (entry.status === "removed" || entry.current === undefined) {
    delete servers[entry.server];
  } else {
    servers[entry.server] = entry.current;
  }
  return configFileSchema.parse({ ...configFile, servers });
}

/**
 * After keep-theirs pulls a client's current value (or removal) into
 * mcp.config.json, the lockfile for that adapter+server must be updated to
 * match — otherwise `computeDrift` keeps reporting the same already-resolved
 * drift forever (and for a removed server, tracks a name that's gone from
 * mcp.config.json with no command left to clear it).
 */
export function updateLockfileAfterKeepTheirs(
  lockfile: LockFile,
  adapterName: string,
  scope: Scope,
  serverName: string,
  refreshedServer: McpServer | undefined,
): LockFile {
  return refreshedServer
    ? updateLockfileEntries(lockfile, adapterName, scope, [refreshedServer])
    : removeLockfileEntries(lockfile, adapterName, scope, [serverName]);
}

function diffEntry(
  before: ServerEntry,
  after: ServerEntry | undefined,
): string[] {
  if (after === undefined) return ["removed from client config"];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const lines: string[] = [];
  for (const key of keys) {
    const b = (before as Record<string, unknown>)[key];
    const a = (after as Record<string, unknown>)[key];
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      const bStr = b === undefined ? "(unset)" : JSON.stringify(b);
      const aStr = a === undefined ? "(unset)" : JSON.stringify(a);
      lines.push(`${key}: ${bStr} -> ${aStr}`);
    }
  }
  return lines;
}
