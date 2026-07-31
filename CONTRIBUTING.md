# Contributing to mcphq

Thanks for considering it — this is an early-stage project and there's real design space left, especially around new client adapters and the upcoming security-checking track.

By participating, you're expected to follow our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Ways to contribute

**Add a new AI client — the easiest and most valuable contribution.** Each client is exactly one file implementing the `ClientAdapter` interface:

```typescript
interface ClientAdapter {
  readonly name: string;         // stable machine name, e.g. "claude-code"
  readonly displayName: string;  // what users see, e.g. "Claude Code"
  detect(): Promise<boolean>;
  getConfigPaths(): ConfigLocation[];
  read(scope: Scope): Promise<ReadResult>;
  write(servers: McpServer[], options: WriteOptions): Promise<WriteResult>;
  remove(names: string[], options: WriteOptions): Promise<WriteResult>;
}
```

Plus one line registering it in `packages/core/src/adapters/index.ts`'s `getAdapters()`. Look at `packages/core/src/adapters/cursor.ts` for the smallest existing example to copy from — it's ~30 lines.

**Other useful contributions:**
- Bug reports with a minimal repro (see the issue templates)
- Improvements to `mcphq doctor`'s reconciliation flow or diff output
- Windows/macOS/Linux path verification for a client you actually use — see `packages/core/src/adapters/CONFIG_LOCATIONS.md`
- Documentation fixes

## Before you start

For anything beyond a small fix, **open an issue first** so we can align on approach before you invest time in a PR. This is especially true for anything touching the write path to `~/.claude.json` — see the note below.

## Development setup

Prerequisite: [Bun](https://bun.sh) 1.3+.

```bash
bun install
bun run mcphq -- <args>   # run the CLI from source, e.g. -- init / -- sync
```

```bash
bun test                  # bun:test, colocated *.test.ts next to source
bun test packages/core/src/adapters   # just the adapter tests
bun run build              # tsc --noEmit per package + CLI bundle
bun run lint                # biome check .
bun run format               # biome format --write .
```

`apps/cli` also has `bun run typecheck` (`tsc --noEmit`).

## Project layout

```
apps/cli/            # the mcphq binary — commands, CLI wiring
packages/core/        # config schema, canonical model, adapters, safe file writes
packages/ui/           # terminal-output helpers
packages/introspect/    # future Go binary for live MCP server introspection
```

`mcp.config.json` (user-authored) → validated by `packages/core/src/canonical.ts` → expanded into canonical `McpServer[]` objects → each `ClientAdapter.write()` upserts those into one client's native config.

## Conventions

- **TypeScript strict mode**, `verbatimModuleSyntax` on — use `import type` for type-only imports, and relative imports need explicit `.js` extensions.
- **Zod v4** for all schemas; validation errors should read as sentences, not stack traces or union-branch dumps.
- **Biome**, not ESLint/Prettier, for lint and format.
- **Every path or JSON shape an adapter touches must be documented** in [`packages/core/src/adapters/CONFIG_LOCATIONS.md`](./packages/core/src/adapters/CONFIG_LOCATIONS.md) *before* the adapter is allowed to write there — this file is the actual spec, not an afterthought.
- **Adapters are upsert-only.** `write()` must never remove or reshape an entry it doesn't own. This is the single most important invariant in the codebase — mcphq's entire pitch depends on never surprising a user by deleting something they hand-configured.
- **Every mutating command supports `--dry-run`.** If you add a new one, it needs a dry-run mode too.

## Testing expectations

- New logic needs a test. `bun:test` files are colocated with their source (`foo.ts` + `foo.test.ts`).
- Adapter changes need round-trip tests: read → canonical → write → re-read → assert equality.
- Don't mock the filesystem — tests use real temp directories (`fs.mkdtempSync`) and real file I/O, cleaned up in `afterEach`. Follow the existing pattern in `packages/core/src/fs-safe.test.ts`.

## Pull request checklist

- [ ] `bun test` passes
- [ ] `bun run build` passes (typecheck across all packages)
- [ ] `bun run lint` passes, or you've explained any pre-existing failures you didn't introduce
- [ ] New/changed adapter behavior is documented in `CONFIG_LOCATIONS.md`
- [ ] PR description explains *why*, not just *what*

We'll review as fast as we reasonably can. Early-stage project, two maintainers — a little patience goes a long way.
