# Client Config Locations

The actual spec of the config-only track. Every path and JSON shape an adapter
touches is documented here first, with how it was verified. Adapters must not
write to a location that is not documented and verified in this file.

Verification levels:
- **verified** — inspected on a real machine with the client installed.
- **docs** — taken from the client's official documentation, not yet checked on a real install. Must be upgraded to *verified* before launch (Phase 8).

---

## Claude Code

| Scope | Path | Notes |
|---|---|---|
| user (mcphq: `global`) | `~/.claude.json` — top-level `mcpServers` key | macOS: **verified** (2026-07-26). Linux/Windows (`%USERPROFILE%\.claude.json`): docs. |
| project | `<project>/.mcp.json` — top-level `mcpServers` key | macOS: **verified** (2026-07-26). Same relative path on all OSes. |
| local (per-project, private) | `~/.claude.json` → `projects["<abs project path>"].mcpServers` | **verified** (2026-07-26). Read-only for mcphq: `import` may read it; `sync` never writes it. |

**Warning — `~/.claude.json` is not a dedicated MCP file.** It is Claude Code's
main state file (30+ top-level keys on a real install: `projects`, `tipsHistory`,
onboarding state, caches, …). The adapter must only ever modify the `mcpServers`
key and must round-trip everything else untouched. This file is the single
riskiest write target in the project.

### Entry shape (verified against a real install)

```jsonc
{
  "mcpServers": {
    // stdio server — "type" is optional for stdio; Claude Code writes it explicitly
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "..." }
    },
    // remote servers
    "linear": { "type": "sse", "url": "https://mcp.linear.app/sse" },
    "example": { "type": "http", "url": "https://mcp.example.com/mcp", "headers": { "Authorization": "Bearer ..." } }
  }
}
```

Notes:
- `.mcp.json` values support `${VAR}` / `${VAR:-default}` env expansion. mcphq
  treats these as opaque strings and must never expand them.
- Claude Code prompts the user to approve `.mcp.json` servers on first use;
  a fresh sync therefore requires a one-time approval inside Claude Code.
- Managed entries may carry extra keys a user added by hand; the adapter
  preserves unknown keys on update (only `type`/`command`/`args`/`env`/`url`/`headers` are owned by mcphq).

---

## Cursor

Sources: [Cursor MCP documentation](https://cursor.com/docs/context/mcp) and a
real macOS installation inspected on 2026-07-28.

| Scope | Windows | macOS / Linux | Verification |
|---|---|---|---|
| user (mcphq: `global`) | `%USERPROFILE%\.cursor\mcp.json` | `~/.cursor/mcp.json` | macOS: **verified**; Windows/Linux: docs, needs external verification before launch |
| project | `<project>\.cursor\mcp.json` | `<project>/.cursor/mcp.json` | docs; same project-relative location on all OSes |

Cursor stores entries under a top-level `mcpServers` map:

```jsonc
{
  "mcpServers": {
    "local": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@example/mcp-server"],
      "env": { "API_KEY": "..." }
    },
    "remote": {
      "type": "streamable-http",
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer ..." }
    },
    "legacy": { "type": "sse", "url": "https://example.com/sse" }
  }
}
```

The adapter accepts remote entries with an omitted `type`, or with `http`,
`streamable-http`, or `sse`. It writes canonical HTTP as `streamable-http` and
SSE as `sse`. Unknown top-level keys, manually configured servers, and
client-only fields on a managed entry are preserved.

---

## VS Code (GitHub Copilot)

Sources: the official [MCP configuration
guide](https://code.visualstudio.com/docs/agent-customization/mcp-servers), [MCP
configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration),
and a real macOS installation inspected on 2026-07-28.

| Scope | Windows | macOS | Linux | Verification |
|---|---|---|---|---|
| user/default profile (mcphq: `global`) | `%APPDATA%\Code\User\mcp.json` | `~/Library/Application Support/Code/User/mcp.json` | `${XDG_CONFIG_HOME:-~/.config}/Code/User/mcp.json` | macOS: **verified**; Windows/Linux: docs, needs external verification before launch |
| workspace (mcphq: `project`) | `<project>\.vscode\mcp.json` | `<project>/.vscode/mcp.json` | `<project>/.vscode/mcp.json` | docs; same project-relative location on all OSes |

VS Code stores entries under a top-level `servers` map:

```jsonc
{
  "servers": {
    "local": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@example/mcp-server"],
      "env": { "API_KEY": "${input:api-key}" }
    },
    "remote": {
      "type": "http",
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer ${input:api-token}" }
    },
    "legacy": { "type": "sse", "url": "https://example.com/sse" }
  },
  "inputs": []
}
```

The file can also contain `inputs` and `sandbox` at the top level, and entries
can contain fields such as `cwd`, `envFile`, `dev`, `sandboxEnabled`, and
`oauth`. The adapter preserves all of them unless the field is one of mcphq's
owned transport fields.

**Named-profile limitation:** VS Code stores MCP configuration per profile. The
Phase 3 adapter syncs the default profile path above and the workspace file; it
does not yet discover and fan out to every named profile under `User/profiles`.

---

## Codex

Source: the official [Codex MCP
documentation](https://developers.openai.com/codex/mcp/) and a real macOS
installation inspected on 2026-07-28.

| Scope | Windows | macOS / Linux | Verification |
|---|---|---|---|
| user (mcphq: `global`) | `%USERPROFILE%\.codex\config.toml` | `~/.codex/config.toml` | macOS: **verified**; Windows/Linux: docs, needs external verification before launch |
| trusted project | `<project>\.codex\config.toml` | `<project>/.codex/config.toml` | docs; same project-relative location on all OSes |

Codex stores each entry in a TOML table under `mcp_servers`:

```toml
[mcp_servers.local]
command = "npx"
args = ["-y", "@example/mcp-server"]

[mcp_servers.local.env]
API_KEY = "value"

[mcp_servers.remote]
url = "https://example.com/mcp"
http_headers = { Authorization = "Bearer value" }
```

Codex supports stdio and Streamable HTTP. It does not expose a distinct legacy
SSE configuration type, so an mcphq `sse` server is written as a URL and reads
back as canonical `http`. Other Codex fields such as `env_vars`, `cwd`, timeout
settings, `enabled`, `required`, tool allow/deny lists, OAuth settings, and
per-tool policy are preserved. The adapter parses and serializes TOML
structurally; unrelated Codex configuration survives, though comments and
formatting may be normalized when a write occurs.
