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

## Cursor (Phase 3 — to be researched)

## VS Code (Phase 3 — to be researched)

## Codex CLI (Phase 3 — to be researched)
