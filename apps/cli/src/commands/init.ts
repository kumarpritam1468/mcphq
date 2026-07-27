import * as path from "node:path";
import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  outro,
  select,
  text,
} from "@clack/prompts";
import {
  CONFIG_FILE_NAME,
  ConfigError,
  type ConfigFile,
  defaultConfig,
  globalConfigPath,
  type Scope,
  serverNameSchema,
  writeConfigFile,
} from "@mcphq/core";
import type { Command } from "commander";
import pc from "picocolors";

interface InitOptions {
  input: boolean; // commander turns --no-input into { input: false }
  global?: boolean;
  force?: boolean;
}

export function registerInit(program: Command): void {
  program
    .command("init")
    .description(
      `create ${CONFIG_FILE_NAME}, your single source of truth for MCP servers`,
    )
    .option("--no-input", "skip prompts and write a minimal default config")
    .option(
      "-g, --global",
      "write the global config instead of a project config",
    )
    .option("-f, --force", "overwrite an existing config file")
    .action(async (options: InitOptions) => {
      try {
        if (options.input) {
          await runInteractive(options);
        } else {
          runNonInteractive(options);
        }
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

function configPathFor(scope: Scope): string {
  return scope === "global"
    ? globalConfigPath()
    : path.join(process.cwd(), CONFIG_FILE_NAME);
}

function runNonInteractive(options: InitOptions): void {
  const scope: Scope = options.global ? "global" : "project";
  const file = configPathFor(scope);
  writeConfigFile(file, defaultConfig(), { force: options.force });
  console.log(`Created ${file}`);
  console.log(`Add servers to it, then run ${pc.bold("mcphq sync")}.`);
}

async function runInteractive(options: InitOptions): Promise<void> {
  intro(pc.bgCyan(pc.black(" mcphq init ")));

  let scope: Scope;
  if (options.global) {
    scope = "global";
  } else {
    const answer = await select({
      message: "Where should this config live?",
      options: [
        {
          value: "project" as const,
          label: "This project",
          hint: `./${CONFIG_FILE_NAME}, checked into the repo`,
        },
        {
          value: "global" as const,
          label: "Globally for this machine",
          hint: globalConfigPath(),
        },
      ],
    });
    if (isCancel(answer)) return bail();
    scope = answer;
  }

  const file = configPathFor(scope);
  const config: ConfigFile = defaultConfig();

  const addFirst = await confirm({
    message: "Add your first server now?",
    initialValue: true,
  });
  if (isCancel(addFirst)) return bail();

  if (addFirst) {
    for (;;) {
      const done = await promptServer(config);
      if (done === "cancelled") return bail();
      const more = await confirm({
        message: "Add another server?",
        initialValue: false,
      });
      if (isCancel(more)) return bail();
      if (!more) break;
    }
  }

  try {
    writeConfigFile(file, config, { force: options.force });
  } catch (err) {
    if (err instanceof ConfigError) {
      cancel(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  log.success(`Created ${pc.bold(file)}`);
  outro(
    `Next: run ${pc.bold("mcphq sync")} to push these servers to your clients.`,
  );
}

async function promptServer(
  config: ConfigFile,
): Promise<"added" | "cancelled"> {
  const name = await text({
    message: "Server name",
    placeholder: "github",
    validate(value) {
      const parsed = serverNameSchema.safeParse(value ?? "");
      if (!parsed.success) return parsed.error.issues[0]?.message;
      if (config.servers[value as string])
        return `"${value}" is already in this config`;
    },
  });
  if (isCancel(name)) return "cancelled";

  const kind = await select({
    message: "How do clients connect to it?",
    options: [
      {
        value: "stdio" as const,
        label: "Local command",
        hint: "stdio, e.g. npx -y server-github",
      },
      {
        value: "http" as const,
        label: "Remote URL (HTTP)",
        hint: "streamable HTTP endpoint",
      },
      {
        value: "sse" as const,
        label: "Remote URL (SSE)",
        hint: "legacy server-sent events endpoint",
      },
    ],
  });
  if (isCancel(kind)) return "cancelled";

  if (kind === "stdio") {
    const commandLine = await text({
      message: "Command to run (with arguments)",
      placeholder: "npx -y @modelcontextprotocol/server-github",
      validate(value) {
        if (!value?.trim()) return "command must not be empty";
      },
    });
    if (isCancel(commandLine)) return "cancelled";
    const [command, ...args] = commandLine.trim().split(/\s+/) as [
      string,
      ...string[],
    ];
    config.servers[name] = { command, ...(args.length > 0 ? { args } : {}) };
  } else {
    const url = await text({
      message: "Server URL",
      placeholder: "https://mcp.example.com/mcp",
      validate(value) {
        try {
          new URL(value ?? "");
        } catch {
          return "must be a valid URL, e.g. https://mcp.example.com/mcp";
        }
      },
    });
    if (isCancel(url)) return "cancelled";
    config.servers[name] = {
      url,
      ...(kind === "sse" ? { transport: "sse" as const } : {}),
    };
  }

  return "added";
}

function bail(): void {
  cancel("Cancelled — nothing was written.");
  process.exitCode = 1;
}
