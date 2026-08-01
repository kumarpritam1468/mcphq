import type { ServerEntry } from "./canonical.js";

export type SecuritySeverity = "warn" | "error";

export interface SecurityFinding {
  rule: string;
  severity: SecuritySeverity;
  message: string;
}

const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\|\s*(sh|bash|zsh)\b/,
  /\brm\s+-rf\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
];

const SHELL_METACHARACTERS = /[;&|`]|\$\(/;

const PACKAGE_RUNNERS = new Set(["npx", "bunx"]);
const DLX_RUNNERS = new Set(["pnpm", "yarn"]);

const SENSITIVE_ENV_PATHS = [
  ".ssh/",
  ".aws/credentials",
  ".git-credentials",
  "id_rsa",
  "/etc/passwd",
  ".npmrc",
];

/** Run every static rule against one config-file server entry. */
export function checkServer(entry: ServerEntry): SecurityFinding[] {
  return entry.command !== undefined
    ? checkStdioEntry(entry)
    : checkRemoteEntry(entry);
}

function checkStdioEntry(entry: ServerEntry): SecurityFinding[] {
  const command = entry.command as string;
  const args = entry.args ?? [];
  const findings: SecurityFinding[] = [];
  const commandLine = [command, ...args].join(" ");

  if (DESTRUCTIVE_PATTERNS.some((p) => p.test(commandLine))) {
    findings.push({
      rule: "destructive-pattern",
      severity: "error",
      message: `command line matches a known-destructive pattern: "${commandLine}"`,
    });
  }

  if ([command, ...args].some((token) => SHELL_METACHARACTERS.test(token))) {
    findings.push({
      rule: "shell-metacharacters",
      severity: "warn",
      message:
        "command or an argument contains shell metacharacters (;, &, |, `, or $()) — a potential command-injection vector",
    });
  }

  const packageSpec = unpinnedPackageSpec(command, args);
  if (packageSpec) {
    findings.push({
      rule: "unpinned-package",
      severity: "warn",
      message: `"${packageSpec}" is not pinned to a version — a future publish can silently change what this server runs`,
    });
  }

  for (const [key, value] of Object.entries(entry.env ?? {})) {
    if (/`|\$\(/.test(value)) {
      findings.push({
        rule: "sensitive-env-command-substitution",
        severity: "error",
        message: `env "${key}" contains command substitution (\` or $()) — this shells out when the value is resolved`,
      });
    }
    if (SENSITIVE_ENV_PATHS.some((p) => value.includes(p))) {
      findings.push({
        rule: "sensitive-env-path",
        severity: "warn",
        message: `env "${key}" references a sensitive path (credentials/keys)`,
      });
    }
  }

  return findings;
}

function checkRemoteEntry(entry: ServerEntry): SecurityFinding[] {
  const url = entry.url as string;
  if (url.startsWith("http://")) {
    return [
      {
        rule: "insecure-remote-url",
        severity: "warn",
        message: `"${url}" uses plain HTTP — credentials and responses travel unencrypted`,
      },
    ];
  }
  return [];
}

/**
 * If `command args` is an unpinned package-runner invocation (e.g.
 * `npx some-pkg` or `pnpm dlx some-pkg`), returns the package spec.
 * Returns null when the command isn't a recognized runner, or the package
 * is already pinned to a version (`some-pkg@1.2.3`).
 */
function unpinnedPackageSpec(command: string, args: string[]): string | null {
  let rest = args;
  if (DLX_RUNNERS.has(command)) {
    if (rest[0] !== "dlx") return null;
    rest = rest.slice(1);
  } else if (!PACKAGE_RUNNERS.has(command)) {
    return null;
  }

  const spec = rest.find((a) => !a.startsWith("-"));
  if (!spec) return null;

  // A scoped package's leading "@scope/" is not a version pin — only a
  // second "@" (after the scope) marks an explicit version.
  const withoutScope = spec.startsWith("@") ? spec.slice(1) : spec;
  return withoutScope.includes("@") ? null : spec;
}
