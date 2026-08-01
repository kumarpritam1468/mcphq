import * as path from "node:path";
import {
  ConfigError,
  computeSyncStatus,
  getDetectedAdapters,
  loadConfig,
} from "@mcphq/core";
import type { Command } from "commander";
import pc from "picocolors";

export function registerList(program: Command): void {
  program
    .command("list")
    .description("show which servers are configured, in which clients")
    .action(async () => {
      try {
        await runList();
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

async function runList(): Promise<void> {
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
    console.log(
      pc.dim(
        "\nNo servers yet. Add one to mcp.config.json, or run `mcphq import`.",
      ),
    );
    return;
  }

  const adapters = await getDetectedAdapters({
    projectDir: path.dirname(config.path),
  });
  const { syncedTo, warnings } = await computeSyncStatus(config, adapters);

  console.log();
  for (const server of config.servers) {
    const clients = syncedTo.get(server.name) ?? [];
    const where =
      clients.length > 0
        ? pc.dim(clients.join(", "))
        : pc.yellow("not synced — run `mcphq sync`");
    console.log(`  ${pc.bold(server.name)}  ${where}`);
  }

  if (warnings.length > 0) {
    console.log();
    for (const warning of warnings)
      console.log(pc.yellow(`  warn: ${warning}`));
  }
}
