import { CORE_NAME } from "@mcphq/core";
import * as ui from "@mcphq/ui";
import { Command } from "commander";

import pkg from "../package.json" with { type: "json" };
import { registerAdd } from "./commands/add.js";
import { registerDoctor } from "./commands/doctor.js";
import { registerImport } from "./commands/import.js";
import { registerInit } from "./commands/init.js";
import { registerList } from "./commands/list.js";
import { registerRemove } from "./commands/remove.js";
import { registerSync } from "./commands/sync.js";

const program = new Command();

program
  .name(CORE_NAME)
  .description(
    "Your MCP headquarters. Define servers once, sync them to every AI client.",
  )
  .version(pkg.version);

registerAdd(program);
registerDoctor(program);
registerImport(program);
registerInit(program);
registerList(program);
registerRemove(program);
registerSync(program);

// Showing help isn't a user error — commander otherwise exits 1 for a bare
// invocation with no subcommand.
if (process.argv.length <= 2) {
  console.log(ui.banner(`${CORE_NAME} — Your MCP headquarters`));
  program.outputHelp();
  process.exit(0);
}

program.parse();
