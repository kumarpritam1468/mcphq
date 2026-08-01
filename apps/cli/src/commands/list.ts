import * as path from "node:path";
import {
  ConfigError,
  computeSyncStatus,
  getDetectedAdapters,
  loadConfig,
} from "@mcphq/core";
import * as ui from "@mcphq/ui";
import type { Command } from "commander";
import pc from "picocolors";

interface ListOptions {
  json?: boolean;
}

export function registerList(program: Command): void {
  program
    .command("list")
    .description("show which servers are configured, in which clients")
    .option("--json", "output machine-readable JSON instead of a report")
    .action(async (options: ListOptions) => {
      try {
        await runList(options);
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

async function runList(options: ListOptions): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.error(
      pc.red(`No mcp.config.json found. Run ${pc.bold("mcphq init")} first.`),
    );
    process.exitCode = 1;
    return;
  }

  const adapters =
    config.servers.length > 0
      ? await getDetectedAdapters({ projectDir: path.dirname(config.path) })
      : [];
  const { syncedTo, warnings } =
    config.servers.length > 0
      ? await computeSyncStatus(config, adapters)
      : { syncedTo: new Map<string, string[]>(), warnings: [] };

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          path: config.path,
          scope: config.scope,
          servers: config.servers.map((s) => ({
            name: s.name,
            syncedToClients: syncedTo.get(s.name) ?? [],
          })),
          warnings,
        },
        null,
        2,
      ),
    );
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
    console.log(ui.section("Warnings"));
    for (const warning of warnings) console.log(`  ${ui.warn(warning)}`);
  }
}
