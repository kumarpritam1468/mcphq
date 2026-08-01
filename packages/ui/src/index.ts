import pc from "picocolors";

export function ok(message: string): string {
  return `${pc.green("ok")} ${message}`;
}

export function warn(message: string): string {
  return `${pc.yellow("warn")} ${message}`;
}

export function error(message: string): string {
  return `${pc.red("error")} ${message}`;
}

/** The one place the mcphq brand mark is defined — used sparingly, in banner moments only. */
export const BRAND = "▪";

/** A top-level banner line, e.g. the CLI's own intro or a report's title. Use sparingly. */
export function banner(title: string): string {
  return `\n${BRAND} ${pc.bold(title)}`;
}

/** A section header within a report, e.g. "Security & trust". */
export function section(title: string): string {
  return `\n${pc.bold(title)}`;
}

/** A dimmed "what to do next" line. */
export function hint(message: string): string {
  return pc.dim(message);
}

/**
 * True when animation/spinners should be skipped: no TTY, NO_COLOR set,
 * --no-color passed, or TERM=dumb. picocolors already handles color itself
 * (including disabling it in all these cases) — this is for callers that
 * need to know whether to show a spinner vs. a static line, and for the one
 * case picocolors gets wrong: it force-enables color on win32 regardless of
 * TTY status, so piping mcphq's output to a file on Windows still needs an
 * explicit check here rather than relying on picocolors alone.
 */
export function isPlain(): boolean {
  return (
    !process.stdout.isTTY ||
    "NO_COLOR" in process.env ||
    process.env.TERM === "dumb" ||
    process.argv.includes("--no-color")
  );
}
