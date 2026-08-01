#!/usr/bin/env node
// picocolors (used throughout the CLI) force-enables color on win32
// regardless of TTY status, so piping mcphq's output to a file on Windows
// would otherwise still embed ANSI codes. This must run — and NO_COLOR must
// be set — before anything that imports picocolors is loaded, which is why
// it's a separate bootstrap file that dynamically imports the real CLI
// rather than a check inside cli.ts itself.
if (
  !process.env.FORCE_COLOR &&
  (!process.stdout.isTTY ||
    "NO_COLOR" in process.env ||
    process.env.TERM === "dumb" ||
    process.argv.includes("--no-color"))
) {
  process.env.NO_COLOR = "1";
}

await import("./cli.js");

export {};
