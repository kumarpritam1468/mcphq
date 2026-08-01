import * as path from "node:path";
import {
  ConfigError,
  defaultConfig,
  fromCanonical,
  getDetectedAdapters,
  loadConfig,
  type McpServer,
  type Scope,
  writeConfigFile,
} from "@mcphq/core";
import * as ui from "@mcphq/ui";
import type { Command } from "commander";
import pc from "picocolors";
import { configPathFor } from "../shared.js";

interface ImportOptions {
  dryRun?: boolean;
  force?: boolean;
  global?: boolean;
}

export function registerImport(program: Command): void {
  program
    .command("import")
    .description(
      "pull servers already configured in your AI clients into mcp.config.json",
    )
    .option(
      "-n, --dry-run",
      "show what would be imported without writing anything",
    )
    .option(
      "-f, --force",
      "overwrite mcp.config.json entries that differ from what's imported",
    )
    .option(
      "-g, --global",
      "import into the global config instead of a project config",
    )
    .action(async (options: ImportOptions) => {
      try {
        await runImport(options);
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

function contentKey(server: McpServer): string {
  const sorted = (rec: Record<string, string>) =>
    Object.entries(rec).sort(([a], [b]) => a.localeCompare(b));
  if (server.transport === "stdio") {
    return JSON.stringify({
      transport: "stdio",
      command: server.command,
      args: server.args,
      env: sorted(server.env),
    });
  }
  return JSON.stringify({
    transport: server.transport,
    url: server.url,
    headers: sorted(server.headers),
  });
}

async function runImport(options: ImportOptions): Promise<void> {
  const existing = loadConfig();
  if (existing && options.global && existing.scope !== "global") {
    console.log(
      pc.yellow(
        `Ignoring --global — using the existing project config at ${existing.path} instead.`,
      ),
    );
  }
  const scope: Scope =
    existing?.scope ?? (options.global ? "global" : "project");
  const targetPath = existing?.path ?? configPathFor(scope);
  const configFile = existing?.config ?? defaultConfig();
  const currentServers = new Map<string, McpServer>(
    (existing?.servers ?? []).map((s) => [s.name, s]),
  );

  const projectDir = existing ? path.dirname(existing.path) : process.cwd();
  const adapters = await getDetectedAdapters({ projectDir });
  if (adapters.length === 0) {
    console.log(ui.warn("no supported AI clients detected on this machine."));
    return;
  }

  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const adapter of adapters) {
    let found: McpServer[];
    try {
      const result = await adapter.read(scope);
      found = result.servers;
      for (const w of result.warnings) {
        console.log(`  ${ui.warn(`${adapter.displayName}: ${w}`)}`);
      }
    } catch (err) {
      console.log(
        `  ${ui.warn(`${adapter.displayName}: ${err instanceof Error ? err.message : String(err)}`)}`,
      );
      continue;
    }

    for (const server of found) {
      const current = currentServers.get(server.name);
      if (!current) {
        currentServers.set(server.name, server);
        added++;
        console.log(
          pc.green(`  + ${server.name}`) +
            pc.dim(` (from ${adapter.displayName})`),
        );
      } else if (contentKey(current) === contentKey(server)) {
        // identical to what's already configured, nothing to do
      } else if (options.force) {
        currentServers.set(server.name, server);
        updated++;
        console.log(
          pc.yellow(`  ~ ${server.name}`) +
            pc.dim(` (overwritten from ${adapter.displayName})`),
        );
      } else {
        skipped++;
        console.log(
          pc.yellow(`  ! ${server.name}`) +
            pc.dim(
              ` differs from ${adapter.displayName}'s entry — skipped, use --force to overwrite`,
            ),
        );
      }
    }
  }

  if (added === 0 && updated === 0) {
    console.log(pc.dim("\nNothing new to import."));
    return;
  }

  console.log(
    pc.dim(
      `\n${added} added, ${updated} updated${skipped > 0 ? `, ${skipped} skipped` : ""}.`,
    ),
  );

  if (options.dryRun) {
    console.log(pc.dim("Dry run — nothing was written."));
    return;
  }

  const servers = Object.fromEntries(
    [...currentServers.values()].map((s) => [s.name, fromCanonical(s)]),
  );
  writeConfigFile(targetPath, { ...configFile, servers }, { force: true });
  console.log(pc.green(`✔ wrote ${targetPath}`));
  console.log(
    ui.hint(
      `Next: run ${pc.bold("mcphq sync")} to push these into every client.`,
    ),
  );
}
