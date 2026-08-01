import { z } from "zod";
import type { ServerEntry } from "./canonical.js";

export const REGISTRY_BASE_URL = "https://registry.modelcontextprotocol.io";
const REQUEST_TIMEOUT_MS = 5000;

/** The registry was unreachable, timed out, or returned something mcphq can't parse. */
export class RegistryError extends Error {}

const envVarSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  isRequired: z.boolean().optional(),
  isSecret: z.boolean().optional(),
  default: z.string().optional(),
});

const headerSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  isRequired: z.boolean().optional(),
  isSecret: z.boolean().optional(),
  value: z.string().optional(),
});

const packageSchema = z.object({
  registryType: z.string(),
  identifier: z.string(),
  version: z.string().optional(),
  runtimeHint: z.string().optional(),
  runtimeArguments: z.array(z.object({ value: z.string() })).optional(),
  environmentVariables: z.array(envVarSchema).optional(),
});

const remoteSchema = z.object({
  type: z.string(),
  url: z.string(),
  headers: z.array(headerSchema).optional(),
});

const rawServerSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  version: z.string().optional(),
  repository: z.object({ url: z.string().optional() }).optional(),
  packages: z.array(packageSchema).optional(),
  remotes: z.array(remoteSchema).optional(),
});

const envelopeSchema = z.object({
  server: rawServerSchema,
  _meta: z
    .object({
      "io.modelcontextprotocol.registry/official": z
        .object({
          status: z.string().optional(),
          publishedAt: z.string().optional(),
          updatedAt: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

const listResponseSchema = z.object({
  servers: z.array(envelopeSchema),
});

export interface EnvVarSpec {
  name: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  default?: string;
}

export interface HeaderSpec {
  name: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  value?: string;
}

export interface RegistryPackage {
  registryType: string;
  identifier: string;
  version?: string;
  runtimeHint?: string;
  runtimeArguments?: { value: string }[];
  environmentVariables?: EnvVarSpec[];
}

export interface RegistryRemote {
  type: string;
  url: string;
  headers?: HeaderSpec[];
}

export interface RegistryServer {
  name: string;
  description?: string;
  version?: string;
  repositoryUrl?: string;
  packages: RegistryPackage[];
  remotes: RegistryRemote[];
  /** From the registry's own metadata: "active" | "deprecated" | "deleted" | "unknown". */
  status: string;
  publishedAt?: string;
  updatedAt?: string;
}

function toRegistryServer(
  envelope: z.infer<typeof envelopeSchema>,
): RegistryServer {
  const official =
    envelope._meta?.["io.modelcontextprotocol.registry/official"];
  return {
    name: envelope.server.name,
    description: envelope.server.description,
    version: envelope.server.version,
    repositoryUrl: envelope.server.repository?.url,
    packages: envelope.server.packages ?? [],
    remotes: envelope.server.remotes ?? [],
    status: official?.status ?? "unknown",
    publishedAt: official?.publishedAt,
    updatedAt: official?.updatedAt,
  };
}

async function registryFetch(path: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${REGISTRY_BASE_URL}${path}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new RegistryError(
      `could not reach the MCP registry (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new RegistryError(`MCP registry returned HTTP ${res.status}`);
  }
  try {
    return await res.json();
  } catch {
    throw new RegistryError(
      "MCP registry returned a response mcphq couldn't parse",
    );
  }
}

/** Look up one server by its exact registry name. Returns null if it doesn't exist. */
export async function fetchRegistryServer(
  name: string,
): Promise<RegistryServer | null> {
  const raw = await registryFetch(
    `/v0/servers/${encodeURIComponent(name)}/versions/latest`,
  );
  if (raw === null) return null;
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RegistryError(
      "MCP registry returned a server mcphq couldn't understand",
    );
  }
  return toRegistryServer(parsed.data);
}

/** Substring search, for suggesting alternatives when an exact name isn't found. */
export async function searchRegistry(
  query: string,
  limit = 5,
): Promise<RegistryServer[]> {
  const raw = await registryFetch(
    `/v0/servers?search=${encodeURIComponent(query)}&version=latest&limit=${limit}`,
  );
  if (raw === null) return [];
  const parsed = listResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RegistryError(
      "MCP registry returned a server list mcphq couldn't understand",
    );
  }
  return parsed.data.servers.map(toRegistryServer);
}

/** Runtimes mcphq knows how to invoke automatically, keyed by registry package type. */
const SUPPORTED_PACKAGE_RUNTIMES: Record<string, string> = {
  npm: "npx",
};

const SUPPORTED_REMOTE_TYPES = new Set(["streamable-http", "http", "sse"]);

export type InstallTarget =
  | { kind: "package"; pkg: RegistryPackage }
  | { kind: "remote"; remote: RegistryRemote }
  | { kind: "unsupported"; reason: string };

/**
 * Pick what mcphq will actually run for this server. Prefers a package over
 * a remote (no auth headers to configure), and only supports the runtimes
 * mcphq knows how to invoke — everything else is a clear "add it by hand".
 */
export function pickInstallTarget(server: RegistryServer): InstallTarget {
  const pkg = server.packages.find(
    (p) => p.registryType in SUPPORTED_PACKAGE_RUNTIMES,
  );
  if (pkg) return { kind: "package", pkg };

  const remote = server.remotes.find((r) => SUPPORTED_REMOTE_TYPES.has(r.type));
  if (remote) return { kind: "remote", remote };

  if (server.packages.length > 0) {
    const kinds = [...new Set(server.packages.map((p) => p.registryType))].join(
      ", ",
    );
    return {
      kind: "unsupported",
      reason: `mcphq can only auto-install npm packages right now (this server ships: ${kinds}). Add it to mcp.config.json by hand.`,
    };
  }
  return {
    kind: "unsupported",
    reason:
      "this server has no package or remote endpoint mcphq knows how to run. Add it to mcp.config.json by hand.",
  };
}

/** Env vars / header values the user must supply before mcphq can build a config entry. */
export function requiredInputs(target: InstallTarget): {
  env: EnvVarSpec[];
  headerVars: string[];
} {
  if (target.kind === "package") {
    return {
      env: (target.pkg.environmentVariables ?? []).filter((e) => e.isRequired),
      headerVars: [],
    };
  }
  if (target.kind === "remote") {
    const headerVars = new Set<string>();
    for (const h of target.remote.headers ?? []) {
      if (!h.isRequired) continue;
      for (const v of templateVars(h.value ?? "")) headerVars.add(v);
    }
    return { env: [], headerVars: [...headerVars] };
  }
  return { env: [], headerVars: [] };
}

const PLACEHOLDER_RE = /\{([a-zA-Z0-9_]+)\}/g;

/** Extract `{varname}` placeholders from a header value template, e.g. `"Bearer {api_key}"`. */
export function templateVars(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER_RE)].map((m) => m[1] as string);
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(
    PLACEHOLDER_RE,
    (_, name: string) => vars[name] ?? "",
  );
}

/** Turn a resolved install target + user-supplied values into a config-file entry. */
export function buildServerEntry(
  target: Extract<InstallTarget, { kind: "package" | "remote" }>,
  values: { env: Record<string, string>; headerVars: Record<string, string> },
): ServerEntry {
  if (target.kind === "package") {
    const args = [
      ...(target.pkg.runtimeArguments ?? []).map((a) => a.value),
      target.pkg.identifier,
    ];
    return {
      command: SUPPORTED_PACKAGE_RUNTIMES[target.pkg.registryType] as string,
      ...(args.length > 0 ? { args } : {}),
      ...(Object.keys(values.env).length > 0 ? { env: values.env } : {}),
    };
  }
  const headers: Record<string, string> = {};
  for (const h of target.remote.headers ?? []) {
    if (h.value) headers[h.name] = interpolate(h.value, values.headerVars);
  }
  return {
    url: target.remote.url,
    ...(target.remote.type === "sse" ? { transport: "sse" as const } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  };
}
