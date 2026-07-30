# mcphq

Your MCP headquarters. Define MCP servers once and sync them to every AI coding client you use.

One HQ. Every client.

mcphq is under active development. The currently usable workflow is `init` and
`sync`; `list`, `remove`, `import`, `add`, and `doctor` are planned but are not
available yet.

## Supported Clients

`sync` currently detects and configures:

- Claude Code
- Cursor
- VS Code with GitHub Copilot
- Codex

`sync --dry-run` prints the exact client configuration paths it will target.
VS Code sync targets the default user profile and the current workspace; named
VS Code profiles are not yet supported.

## Try It

Prerequisite: [Bun](https://bun.sh/) 1.3 or later. Clone the repository and
install dependencies:

```bash
bun install
```

Create a project-level source-of-truth config. The interactive flow lets you
enter a server immediately:

```bash
bun run mcphq -- init
```

Alternatively, create the empty file without prompts:

```bash
bun run mcphq -- init --no-input
```

Add a server under `servers` in the generated `mcp.config.json`. For example:

```json
{
  "servers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```

Preview every change first. This parses detected client configurations and
prints the target path and planned server changes without modifying a file:

```bash
bun run mcphq -- sync --dry-run
```

When the preview is correct, write the config to each detected client:

```bash
bun run mcphq -- sync
```

If an existing client entry has the same name but differs from
`mcp.config.json`, mcphq asks before replacing it. Use `--force` to accept all
such updates, or `--no-input` to skip them in CI or scripts:

```bash
bun run mcphq -- sync --force
bun run mcphq -- sync --no-input
```

## What Sync Changes

`mcp.config.json` is the source of truth. Sync upserts only the named servers
from that file. It does not remove manually configured servers or unrelated
client settings.

Before replacing an existing config file, mcphq creates a rolling backup beside
it with the `.mcphq-backup` suffix. Writes are atomic: the new file is written
and parsed as a temporary file before replacing the original.

Codex uses TOML rather than JSON. Its unrelated configuration and MCP policy
fields are preserved, but comments and formatting can be normalized on a write.
Codex supports stdio and Streamable HTTP; an `sse` source entry is written as a
URL and reads back as HTTP because Codex has no separate SSE configuration
type.

## Manual Acceptance Test

Use this once you have at least two supported clients installed:

1. Add a test server to `mcp.config.json` and run `sync --dry-run`.
2. Confirm the preview identifies the expected client paths and only the server you added.
3. Run `sync`, then confirm the server appears in at least two client configs.
4. Confirm a pre-existing manual server and unrelated client settings remain unchanged.
5. Confirm each modified existing config has a neighboring `.mcphq-backup` file.
6. Run `sync --dry-run` again and confirm the managed server is reported as unchanged.

Do not use `--force` for this test unless you intentionally want
`mcp.config.json` to replace an existing same-named client entry.

## Development

```bash
bun run mcphq -- --version                # run the CLI
bun test                                  # run tests
bun run build                             # turbo build across packages
bun run lint                              # biome
```

Run only the adapter tests while working on sync behavior:

```bash
bun test packages/core/src/adapters
```

The full test suite includes round-trip, merge-preservation, dry-run, invalid
config, backup, and atomic-write coverage for all four adapters.
