#!/usr/bin/env node
import { CORE_NAME } from "@mcphq/core";
import { Command } from "commander";

import pkg from "../package.json" with { type: "json" };
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

registerDoctor(program);
registerImport(program);
registerInit(program);
registerList(program);
registerRemove(program);
registerSync(program);

program.parse();
