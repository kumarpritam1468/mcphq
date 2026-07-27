import { ClaudeCodeAdapter } from "./claude-code.js";
import type { ClientAdapter } from "./types.js";

export interface AdapterContext {
  /** Project root, used by adapters with project-scoped config files. */
  projectDir?: string;
}

/**
 * The adapter registry. `sync` (and later `doctor`, `import`, `remove`)
 * fans out over this list. Adding a client = one adapter file + one line here.
 */
export function getAdapters(context: AdapterContext = {}): ClientAdapter[] {
  return [new ClaudeCodeAdapter({ projectDir: context.projectDir })];
}

/** Only the adapters whose client is actually installed on this machine. */
export async function getDetectedAdapters(
  context: AdapterContext = {},
): Promise<ClientAdapter[]> {
  const adapters = getAdapters(context);
  const detected = await Promise.all(adapters.map((a) => a.detect()));
  return adapters.filter((_, i) => detected[i]);
}
