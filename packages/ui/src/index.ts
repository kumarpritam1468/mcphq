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
