#!/usr/bin/env node
import { CORE_NAME } from "@mcphq/core";
import { Command } from "commander";

import pkg from "../package.json" with { type: "json" };
import { registerInit } from "./commands/init.js";
import { registerSync } from "./commands/sync.js";

const program = new Command();

program
  .name(CORE_NAME)
  .description(
    "Your MCP headquarters. Define servers once, sync them to every AI client.",
  )
  .version(pkg.version);

registerInit(program);
registerSync(program);

program.parse();
