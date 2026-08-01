import * as path from "node:path";
import {
  type ClientAdapter,
  ConfigError,
  getDetectedAdapters,
  type LoadedConfig,
  loadConfig,
  lockfilePathFor,
  readLockfile,
  type ServerChange,
  updateLockfileEntries,
  type WriteResult,
  writeLockfile,
} from "@mcphq/core";
import * as ui from "@mcphq/ui";
import type { Command } from "commander";
import pc from "picocolors";
import { confirmOrForce } from "../shared.js";

interface SyncOptions {
  dryRun?: boolean;
  force?: boolean;
  input: boolean; // --no-input
}

export function registerSync(program: Command): void {
  program
    .command("sync")
    .description(
      "write your mcp.config.json servers into every detected AI client",
    )
    .option("-n, --dry-run", "show what would change without writing anything")
    .option(
      "-f, --force",
      "overwrite client entries that differ from your config without asking",
    )
    .option(
      "--no-input",
      "never prompt; differing entries are skipped unless --force",
    )
    .action(async (options: SyncOptions) => {
      try {
        await runSync(options);
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

export async function runSync(options: SyncOptions): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.error(
      pc.red(`No mcp.config.json found. Run ${pc.bold("mcphq init")} first.`),
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Config: ${pc.bold(config.path)} ${pc.dim(`(${config.scope} scope, ${config.servers.length} server${config.servers.length === 1 ? "" : "s"})`)}`,
  );

  if (config.servers.length === 0) {
    console.log(pc.yellow("Nothing to sync — the config has no servers yet."));
    return;
  }

  const adapters = await getDetectedAdapters({
    projectDir: path.dirname(config.path),
  });
  if (adapters.length === 0) {
    console.error(
      ui.error(
        "no supported AI clients detected on this machine. Nothing to sync to.",
      ),
    );
    process.exitCode = 1;
    return;
  }

  let wroteAnything = false;
  let lockfile = readLockfile(lockfilePathFor(config.path));
  for (const adapter of adapters) {
    wroteAnything =
      (await syncAdapter(adapter, config, options)) || wroteAnything;
    if (!options.dryRun) {
      const finalState = await adapter.read(config.scope);
      const owned = finalState.servers.filter((s) =>
        config.servers.some((c) => c.name === s.name),
      );
      lockfile = updateLockfileEntries(
        lockfile,
        adapter.name,
        config.scope,
        owned,
      );
    }
  }
  if (!options.dryRun) {
    writeLockfile(lockfilePathFor(config.path), lockfile);
  }

  if (options.dryRun) {
    console.log(pc.dim("\nDry run — nothing was written."));
  } else if (!wroteAnything) {
    console.log(pc.green("\nEverything already in sync."));
  }
}

/** Returns true when something was written to this client. */
async function syncAdapter(
  adapter: ClientAdapter,
  config: LoadedConfig,
  options: SyncOptions,
): Promise<boolean> {
  const plan = await adapter.write(config.servers, {
    scope: config.scope,
    dryRun: true,
  });

  console.log(`\n${pc.bold(adapter.displayName)} ${pc.dim(`→ ${plan.path}`)}`);
  renderChanges(plan.changes);

  if (options.dryRun) return false;

  const updates = plan.changes.filter((c) => c.action === "update");
  let serversToWrite = config.servers;

  if (updates.length > 0) {
    const approved = await confirmOrForce(
      options.force,
      options.input,
      `${adapter.displayName}: overwrite ${updates.length} differing entr${updates.length === 1 ? "y" : "ies"} (shown above)?`,
    );
    if (!approved) {
      const skipped = new Set(updates.map((u) => u.server));
      serversToWrite = config.servers.filter((s) => !skipped.has(s.name));
      console.log(
        `  ${ui.warn(`skipped ${skipped.size} differing entr${skipped.size === 1 ? "y" : "ies"} — re-run with --force to overwrite.`)}`,
      );
    }
  }

  const hasWork = plan.changes.some(
    (c) =>
      c.action !== "unchanged" &&
      serversToWrite.some((s) => s.name === c.server),
  );
  if (!hasWork) return false;

  const result: WriteResult = await adapter.write(serversToWrite, {
    scope: config.scope,
  });
  if (result.written) {
    console.log(pc.green(`  ✔ wrote ${result.path}`));
    if (result.backupPath) {
      console.log(pc.dim(`    backup: ${result.backupPath}`));
    }
  }
  return result.written;
}

function renderChanges(changes: ServerChange[]): void {
  for (const change of changes) {
    if (change.action === "add") {
      console.log(pc.green(`  + ${change.server}`));
    } else if (change.action === "update") {
      console.log(pc.yellow(`  ~ ${change.server}`));
      for (const detail of change.details ?? []) {
        console.log(pc.dim(`      ${detail}`));
      }
    } else {
      console.log(pc.dim(`  = ${change.server} (unchanged)`));
    }
  }
}
