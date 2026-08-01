import { isCancel, password, text } from "@clack/prompts";
import {
  buildServerEntry,
  ConfigError,
  defaultConfig,
  fetchRegistryServer,
  isAllowlisted,
  loadConfig,
  pickInstallTarget,
  RegistryError,
  type RegistryServer,
  requiredInputs,
  type Scope,
  searchRegistry,
  writeConfigFile,
} from "@mcphq/core";
import type { Command } from "commander";
import pc from "picocolors";
import { configPathFor, confirmOrForce } from "../shared.js";
import { runSync } from "./sync.js";

interface AddOptions {
  force?: boolean;
  input: boolean; // --no-input
  global?: boolean;
}

export function registerAdd(program: Command): void {
  program
    .command("add <server>")
    .description(
      "look up a server in the MCP registry, show who publishes it, then add and sync it",
    )
    .option(
      "-f, --force",
      "skip the trust confirmation and proceed without asking",
    )
    .option("--no-input", "never prompt; requires --force to add anything")
    .option(
      "-g, --global",
      "add to the global config instead of a project config",
    )
    .action(async (name: string, options: AddOptions) => {
      try {
        await runAdd(name, options);
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

async function runAdd(name: string, options: AddOptions): Promise<void> {
  const existing = loadConfig();
  if (existing?.config.servers[name]) {
    console.error(
      pc.red(`"${name}" is already in ${existing.path}.`) +
        ` Run ${pc.bold(`mcphq remove ${name}`)} first to replace it.`,
    );
    process.exitCode = 1;
    return;
  }

  let server: RegistryServer | null;
  try {
    server = await fetchRegistryServer(name);
  } catch (err) {
    const message = err instanceof RegistryError ? err.message : String(err);
    console.error(
      pc.yellow(`Could not look up "${name}": ${message}`) +
        "\nTry again once the registry is reachable, or add it to mcp.config.json by hand.",
    );
    process.exitCode = 1;
    return;
  }

  if (!server) {
    console.error(pc.red(`"${name}" was not found in the MCP registry.`));
    const suggestions = await searchRegistry(name, 5).catch(() => []);
    if (suggestions.length > 0) {
      console.log(pc.dim("\nDid you mean:"));
      for (const s of suggestions) console.log(pc.dim(`  ${s.name}`));
    }
    process.exitCode = 1;
    return;
  }

  const target = pickInstallTarget(server);
  if (target.kind === "unsupported") {
    console.error(pc.red(target.reason));
    process.exitCode = 1;
    return;
  }

  const trusted = isAllowlisted(server.repositoryUrl);
  printTrustInfo(server, trusted);

  const approved = await confirmOrForce(
    options.force,
    options.input,
    `Add "${name}" to mcp.config.json?`,
  );
  if (!approved) {
    console.log(pc.yellow("Cancelled — nothing was added."));
    process.exitCode = 1;
    return;
  }

  const inputs = requiredInputs(target);
  const env: Record<string, string> = {};
  const headerVars: Record<string, string> = {};

  if (
    (inputs.env.length > 0 || inputs.headerVars.length > 0) &&
    !options.input
  ) {
    console.error(
      pc.red(
        `"${name}" needs values for ${[...inputs.env.map((e) => e.name), ...inputs.headerVars].join(", ")} — re-run without --no-input to provide them.`,
      ),
    );
    process.exitCode = 1;
    return;
  }

  for (const spec of inputs.env) {
    const prompt = spec.isSecret ? password : text;
    const answer = await prompt({
      message: spec.description
        ? `${spec.name} — ${spec.description}`
        : spec.name,
      validate: (value) => (value ? undefined : `${spec.name} is required`),
    });
    if (isCancel(answer)) return bail();
    env[spec.name] = answer;
  }
  for (const varName of inputs.headerVars) {
    const answer = await password({
      message: `Value for {${varName}}`,
      validate: (value) => (value ? undefined : `${varName} is required`),
    });
    if (isCancel(answer)) return bail();
    headerVars[varName] = answer;
  }

  const entry = buildServerEntry(target, { env, headerVars });

  const scope: Scope =
    existing?.scope ?? (options.global ? "global" : "project");
  const targetPath = existing?.path ?? configPathFor(scope);
  const configFile = existing?.config ?? defaultConfig();
  writeConfigFile(
    targetPath,
    { ...configFile, servers: { ...configFile.servers, [name]: entry } },
    { force: true },
  );
  console.log(pc.green(`✔ wrote ${targetPath}`));

  await runSync({ force: options.force, input: options.input });
}

function printTrustInfo(server: RegistryServer, trusted: boolean): void {
  console.log(
    `\n${pc.bold(server.name)}${server.version ? pc.dim(` v${server.version}`) : ""}`,
  );
  if (server.description) console.log(pc.dim(server.description));
  if (server.repositoryUrl) console.log(`  publisher: ${server.repositoryUrl}`);
  console.log(
    `  status: ${server.status === "active" ? pc.green(server.status) : pc.yellow(server.status)}`,
  );
  if (server.updatedAt) console.log(`  last updated: ${server.updatedAt}`);
  if (trusted) {
    console.log(pc.green("  ✔ publisher is on the mcphq-curated allowlist"));
  } else {
    console.log(
      pc.yellow(
        "  ! not on the mcphq-curated allowlist — verify the publisher before trusting it",
      ),
    );
  }
}

function bail(): void {
  console.log(pc.yellow("Cancelled — nothing was added."));
  process.exitCode = 1;
}
