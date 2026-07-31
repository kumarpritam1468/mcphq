import * as path from "node:path";
import { confirm, isCancel } from "@clack/prompts";
import { CONFIG_FILE_NAME, globalConfigPath, type Scope } from "@mcphq/core";

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
