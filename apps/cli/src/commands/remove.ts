import * as path from "node:path";
import {
  ConfigError,
  getDetectedAdapters,
  loadConfig,
  lockfilePathFor,
  readLockfile,
  removeLockfileEntries,
  writeConfigFile,
  writeLockfile,
} from "@mcphq/core";
import * as ui from "@mcphq/ui";
import type { Command } from "commander";
import pc from "picocolors";
import { confirmOrForce } from "../shared.js";

interface RemoveOptions {
  dryRun?: boolean;
  force?: boolean;
  input: boolean; // --no-input
}

export function registerRemove(program: Command): void {
  program
    .command("remove <server>")
    .description("remove a server from mcp.config.json and every synced client")
    .option("-n, --dry-run", "show what would change without writing anything")
    .option("-f, --force", "skip the confirmation prompt")
    .option("--no-input", "never prompt; requires --force to actually remove")
    .action(async (server: string, options: RemoveOptions) => {
      try {
        await runRemove(server, options);
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

async function runRemove(name: string, options: RemoveOptions): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.error(
      pc.red(`No mcp.config.json found. Run ${pc.bold("mcphq init")} first.`),
    );
    process.exitCode = 1;
    return;
  }

  if (!Object.hasOwn(config.config.servers, name)) {
    console.error(
      pc.red(`"${name}" is not in ${config.path}.`) +
        ` Run ${pc.bold("mcphq list")} to see configured servers.`,
    );
    process.exitCode = 1;
    return;
  }

  const adapters = await getDetectedAdapters({
    projectDir: path.dirname(config.path),
  });

  console.log(`Removing ${pc.bold(name)}:`);
  console.log(`  ${config.path}`);
  let clientTargets = 0;
  for (const adapter of adapters) {
    const plan = await adapter.remove([name], {
      scope: config.scope,
      dryRun: true,
    });
    if (plan.changes.length > 0) {
      console.log(`  ${adapter.displayName} → ${plan.path}`);
      clientTargets++;
    }
  }

  if (options.dryRun) {
    console.log(pc.dim("\nDry run — nothing was written."));
    return;
  }

  const approved = await confirmOrForce(
    options.force,
    options.input,
    `Remove "${name}" from mcp.config.json and ${clientTargets} client${clientTargets === 1 ? "" : "s"}?`,
  );
  if (!approved) {
    console.log(ui.warn("cancelled — nothing was removed."));
    process.exitCode = 1;
    return;
  }

  for (const adapter of adapters) {
    const result = await adapter.remove([name], { scope: config.scope });
    if (result.written) {
      console.log(pc.green(`  ✔ removed from ${result.path}`));
    }
  }

  let lockfile = readLockfile(lockfilePathFor(config.path));
  for (const adapter of adapters) {
    lockfile = removeLockfileEntries(lockfile, adapter.name, config.scope, [
      name,
    ]);
  }
  writeLockfile(lockfilePathFor(config.path), lockfile);

  const remainingServers = { ...config.config.servers };
  delete remainingServers[name];
  writeConfigFile(
    config.path,
    { ...config.config, servers: remainingServers },
    { force: true },
  );
  console.log(pc.green(`  ✔ removed from ${config.path}`));
}
