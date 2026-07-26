# @mcphq/introspect (Go)

Standalone Go binary for live MCP server introspection (Phase 10 in docs/PLAN.md). Connects to configured servers as a real MCP client, calls `tools/list`, estimates token cost, and scans tool descriptions for risk. The TS CLI shells out to this binary and reads structured JSON from stdout.

Stub for now. Not a Bun workspace package; it has its own `go.mod` and is built with the Go toolchain:

```bash
cd packages/introspect
go build -o ../../bin/mcphq-introspect .
```
