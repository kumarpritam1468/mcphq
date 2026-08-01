import * as path from "node:path";
import { confirm, isCancel, spinner } from "@clack/prompts";
import { CONFIG_FILE_NAME, globalConfigPath, type Scope } from "@mcphq/core";
import * as ui from "@mcphq/ui";

/** Where a config for `scope` lives when one doesn't already exist. */
export function configPathFor(scope: Scope): string {
  return scope === "global"
    ? globalConfigPath()
    : path.join(process.cwd(), CONFIG_FILE_NAME);
}

/**
 * Resolve whether an action is approved: `--force` always approves,
 * `--no-input` always declines without prompting, otherwise ask interactively.
 */
export async function confirmOrForce(
  force: boolean | undefined,
  input: boolean,
  message: string,
): Promise<boolean> {
  if (force) return true;
  if (!input) return false;
  const answer = await confirm({ message, initialValue: true });
  return !isCancel(answer) && answer;
}

/**
 * Run a slow, silent async call with feedback per clig.dev's "print
 * something within 100ms" rule. Falls back to a single static line (no
 * animation) when `ui.isPlain()` — no TTY, NO_COLOR, --no-color, CI.
 */
export async function withSpinner<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (ui.isPlain()) {
    console.log(label);
    return fn();
  }
  const s = spinner();
  s.start(label);
  try {
    const result = await fn();
    s.stop(label);
    return result;
  } catch (err) {
    s.stop(label, 1);
    throw err;
  }
}
