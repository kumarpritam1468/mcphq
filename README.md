# mcphq

Your MCP headquarters. Define your MCP servers once, sync them to every AI coding client you use, and know whether each one is safe before it touches your machine.

One HQ. Every client.

Under construction. See [docs/PLAN.md](docs/PLAN.md) for the build plan and [docs/KNOWLEDGE.md](docs/KNOWLEDGE.md) for how the project works.

## Development

```bash
bun install
bun run --filter=mcphq dev -- --version   # run the CLI
bun test                                  # run tests
bun run build                             # turbo build across packages
bun run lint                              # biome
```
