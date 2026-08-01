import { z } from "zod";

/** Where a config (and the servers defined in it) lives. */
export const SCOPES = ["project", "global"] as const;
export type Scope = (typeof SCOPES)[number];

/** How a client talks to the server process/endpoint. */
export const TRANSPORTS = ["stdio", "http", "sse"] as const;
export type Transport = (typeof TRANSPORTS)[number];

/**
 * The canonical server model. Everything in mcphq — adapters, sync, doctor —
 * speaks this shape. Client-specific formats exist only inside adapters.
 */
export type McpServer =
  | {
      name: string;
      scope: Scope;
      transport: "stdio";
      command: string;
      args: string[];
      env: Record<string, string>;
    }
  | {
      name: string;
      scope: Scope;
      transport: "http" | "sse";
      url: string;
      headers: Record<string, string>;
    };

export const serverNameSchema = z
  .string()
  .min(1, "server name must not be empty")
  .max(128, "server name must be 128 characters or fewer")
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/,
    'server name must start with a letter or digit and contain only letters, digits, ".", "_", "-", or a single "/" (for registry-style names like "org/server")',
  );

/**
 * One entry under "servers" in mcp.config.json. A single permissive object
 * plus a refinement (instead of a union) so validation errors read like
 * sentences, not a dump of every union branch that failed.
 */
export const serverEntrySchema = z
  .strictObject({
    transport: z.enum(TRANSPORTS).optional(),
    command: z.string().min(1, "command must not be empty").optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.url({ error: "url must be a valid http(s) URL" }).optional(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .superRefine((entry, ctx) => {
    if (entry.command !== undefined && entry.url !== undefined) {
      ctx.addIssue({
        code: "custom",
        message:
          'a server is either local ("command") or remote ("url"), never both — remove one',
      });
      return;
    }
    if (entry.command === undefined && entry.url === undefined) {
      ctx.addIssue({
        code: "custom",
        message:
          'a server needs either "command" (local stdio server) or "url" (remote server)',
      });
      return;
    }
    if (entry.command !== undefined) {
      if (entry.transport !== undefined && entry.transport !== "stdio") {
        ctx.addIssue({
          code: "custom",
          path: ["transport"],
          message: `transport "${entry.transport}" requires "url" — servers with "command" always use "stdio"`,
        });
      }
      if (entry.url !== undefined || entry.headers !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: '"headers" only applies to remote servers with "url"',
        });
      }
    } else {
      if (entry.transport === "stdio") {
        ctx.addIssue({
          code: "custom",
          path: ["transport"],
          message:
            'transport "stdio" requires "command" — remote servers use "http" or "sse"',
        });
      }
      if (entry.args !== undefined || entry.env !== undefined) {
        ctx.addIssue({
          code: "custom",
          message:
            '"args" and "env" only apply to local servers with "command"',
        });
      }
    }
  });

export type ServerEntry = z.infer<typeof serverEntrySchema>;

/** The shape of mcp.config.json itself. */
export const configFileSchema = z.strictObject({
  $schema: z.string().optional(),
  servers: z.record(serverNameSchema, serverEntrySchema),
});

export type ConfigFile = z.infer<typeof configFileSchema>;

/** Expand a validated config file into the canonical server list. */
export function toCanonical(config: ConfigFile, scope: Scope): McpServer[] {
  return Object.entries(config.servers).map(([name, entry]) => {
    if (entry.command !== undefined) {
      return {
        name,
        scope,
        transport: "stdio" as const,
        command: entry.command,
        args: entry.args ?? [],
        env: entry.env ?? {},
      };
    }
    return {
      name,
      scope,
      transport:
        entry.transport === "sse" ? ("sse" as const) : ("http" as const),
      // superRefine guarantees url is present when command is absent
      url: entry.url as string,
      headers: entry.headers ?? {},
    };
  });
}

/** Inverse of `toCanonical`: turn a canonical server back into a config-file entry. */
export function fromCanonical(server: McpServer): ServerEntry {
  if (server.transport === "stdio") {
    return {
      command: server.command,
      ...(server.args.length > 0 ? { args: server.args } : {}),
      ...(Object.keys(server.env).length > 0 ? { env: server.env } : {}),
    };
  }
  return {
    url: server.url,
    ...(server.transport === "sse" ? { transport: "sse" as const } : {}),
    ...(Object.keys(server.headers).length > 0
      ? { headers: server.headers }
      : {}),
  };
}
