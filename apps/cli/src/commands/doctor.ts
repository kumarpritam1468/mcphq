import * as path from "node:path";
import { isCancel, select } from "@clack/prompts";
import {
  type ClientAdapter,
  ConfigError,
  type ConfigFile,
  checkServer,
  computeDrift,
  computeSyncStatus,
  configFileSchema,
  type DriftEntry,
  fetchRegistryServer,
  fromCanonical,
  getDetectedAdapters,
  isAllowlisted,
  type LoadedConfig,
  type LockFile,
  loadConfig,
  lockfilePathFor,
  type McpServer,
  RegistryError,
  readLockfile,
  removeLockfileEntries,
  type Scope,
  type ServerEntry,
  toCanonical,
  updateLockfileEntries,
  writeConfigFile,
  writeLockfile,
} from "@mcphq/core";
import * as ui from "@mcphq/ui";
import type { Command } from "commander";
import pc from "picocolors";
import { withSpinner } from "../shared.js";

interface DoctorOptions {
  json?: boolean;
}

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("check every synced client for drift since the last sync")
    .option(
      "--json",
      "output machine-readable JSON instead of a report (skips interactive drift reconciliation)",
    )
    .action(async (options: DoctorOptions) => {
      try {
        await runDoctor(options);
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

async function runDoctor(options: DoctorOptions): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.error(
      pc.red(`No mcp.config.json found. Run ${pc.bold("mcphq init")} first.`),
    );
    process.exitCode = 1;
    return;
  }

  const adapters = await getDetectedAdapters({
    projectDir: path.dirname(config.path),
  });

  if (options.json) {
    await runDoctorJson(config, adapters);
    return;
  }

  let foundAnything = await reportSecurityAndTrust(config);
  foundAnything = (await reportSyncStatus(config, adapters)) || foundAnything;

  const lockfilePath = lockfilePathFor(config.path);
  let lockfile = readLockfile(lockfilePath);

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

  if (!foundAnything && !foundDrift) {
    console.log(pc.green("\nNo issues found — everything is clean."));
  }
}

/**
 * The --json path: same underlying checks as the human report, but no
 * interactive drift reconciliation (can't prompt when output is meant to be
 * parsed) — drift is reported statically instead.
 */
async function runDoctorJson(
  config: LoadedConfig,
  adapters: ClientAdapter[],
): Promise<void> {
  const security = config.servers.flatMap((server) =>
    checkServer(fromCanonical(server)).map((f) => ({
      server: server.name,
      rule: f.rule,
      severity: f.severity,
      message: f.message,
    })),
  );

  const trust: { server: string; status: string; allowlisted: boolean }[] = [];
  for (const server of config.servers) {
    try {
      const registryServer = await fetchRegistryServer(server.name);
      if (registryServer) {
        trust.push({
          server: server.name,
          status: registryServer.status,
          allowlisted: isAllowlisted(registryServer.repositoryUrl),
        });
      }
    } catch (err) {
      if (!(err instanceof RegistryError)) throw err;
      break;
    }
  }

  const { syncedTo, warnings } = await computeSyncStatus(config, adapters);
  const unsynced = config.servers
    .filter((s) => (syncedTo.get(s.name) ?? []).length === 0)
    .map((s) => s.name);

  const lockfile = readLockfile(lockfilePathFor(config.path));
  const drift: { client: string; server: string; status: string }[] = [];
  for (const adapter of adapters) {
    const current = await adapter.read(config.scope);
    for (const entry of computeDrift(
      lockfile,
      adapter.name,
      config.scope,
      current.servers,
    )) {
      drift.push({
        client: adapter.displayName,
        server: entry.server,
        status: entry.status,
      });
    }
  }

  console.log(
    JSON.stringify(
      { security, trust, syncStatus: { unsynced, warnings }, drift },
      null,
      2,
    ),
  );
}

/** Static security checks + best-effort registry trust info, per configured server. */
async function reportSecurityAndTrust(config: LoadedConfig): Promise<boolean> {
  const lines = await withSpinner(
    "Checking servers for security issues and registry trust...",
    () => gatherSecurityAndTrustLines(config),
  );

  if (lines.length === 0) return false;
  console.log(ui.section("Security & trust"));
  for (const line of lines) console.log(line);
  return true;
}

async function gatherSecurityAndTrustLines(
  config: LoadedConfig,
): Promise<string[]> {
  const lines: string[] = [];
  let registryDown = false;

  for (const server of config.servers) {
    for (const finding of checkServer(fromCanonical(server))) {
      lines.push(
        `  ${pc.bold(server.name)}: ${finding.severity === "error" ? ui.error(finding.message) : ui.warn(finding.message)}`,
      );
    }

    if (registryDown) continue;
    try {
      const registryServer = await fetchRegistryServer(server.name);
      if (!registryServer) continue;
      const trusted = isAllowlisted(registryServer.repositoryUrl);
      const clean = trusted && registryServer.status === "active";
      const detail = `registry: ${registryServer.status}${trusted ? ", allowlisted publisher" : ", not on the mcphq-curated allowlist"}`;
      lines.push(
        `  ${pc.bold(server.name)}: ${clean ? ui.ok(detail) : ui.warn(detail)}`,
      );
    } catch (err) {
      if (!(err instanceof RegistryError)) throw err;
      registryDown = true;
      lines.push(
        `  ${ui.warn(`MCP registry unreachable — skipping trust checks for the rest of this run (${err.message})`)}`,
      );
    }
  }

  return lines;
}

/** Configured servers that aren't synced anywhere, and client entries mcphq couldn't parse. */
async function reportSyncStatus(
  config: LoadedConfig,
  adapters: ClientAdapter[],
): Promise<boolean> {
  const { syncedTo, warnings } = await computeSyncStatus(config, adapters);
  const unsynced = config.servers.filter(
    (s) => (syncedTo.get(s.name) ?? []).length === 0,
  );
  if (unsynced.length === 0 && warnings.length === 0) return false;

  console.log(ui.section("Sync status"));
  for (const server of unsynced) {
    console.log(
      `  ${ui.warn(`"${server.name}" is not synced to any client — run \`mcphq sync\``)}`,
    );
  }
  for (const warning of warnings) {
    console.log(`  ${ui.warn(warning)}`);
  }
  return true;
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
