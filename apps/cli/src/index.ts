#!/usr/bin/env node
import { CORE_NAME } from "@mcphq/core";
import { Command } from "commander";

import pkg from "../package.json" with { type: "json" };

const program = new Command();

program
  .name(CORE_NAME)
  .description(
    "Your MCP headquarters. Define servers once, sync them to every AI client.",
  )
  .version(pkg.version);

program.parse();
