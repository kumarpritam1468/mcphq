# Security Policy

mcphq writes to configuration files used by AI coding tools (`~/.claude.json`, project `.mcp.json`, Cursor/VS Code/Codex configs). That write path — and the config it writes — is the highest-risk surface in this project. We take reports affecting it seriously.

## Supported Versions

mcphq is pre-1.0 and under active development. Only the latest commit on `main` is supported — there is no back-porting of fixes to older tags yet. Once we cut a 1.0, this table will track maintained release lines.

| Version | Supported |
| --- | --- |
| `main` (latest) | ✅ |
| anything older | ❌ |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, email us directly at:

- **manoharipritam@gmail.com**
- **sujalkrghosh@gmail.com**

Include as much detail as you can:

- What the vulnerability is and what it affects (e.g. a specific adapter, the config loader, the atomic-write path)
- Steps to reproduce, or a minimal proof of concept
- The potential impact (e.g. arbitrary file write/overwrite, config injection, secret exposure)

We'll acknowledge your report within a few days and keep you updated as we investigate and fix it. We ask that you give us a reasonable amount of time to address the issue before any public disclosure.

## Scope

Things we consider in scope:

- Any way `mcphq sync`/`doctor`/`import`/`remove` could write outside its intended target file, corrupt a config file beyond recovery (bypassing the backup/atomic-write safety net in `packages/core/src/fs-safe.ts`), or write attacker-controlled content into a client config.
- Any way a malicious `mcp.config.json` (e.g. from a shared/cloned repo) could cause mcphq to do something unexpected beyond writing the servers it declares.
- Secrets (tokens, API keys in `env`/`headers`) being logged, written to an unintended location, or leaked in error messages.

Things generally out of scope:

- The security of MCP servers themselves once mcphq has configured them — that's the server's and the client's responsibility, not mcphq's (static security checks for known-bad server patterns are on the [roadmap](./README.md#roadmap), not yet shipped).
- Denial of service against your own machine (e.g. an intentionally huge config file).

## Disclosure

We follow coordinated disclosure. Once a reported issue is fixed and released, we'll credit the reporter (unless you'd prefer to stay anonymous) in the release notes.
