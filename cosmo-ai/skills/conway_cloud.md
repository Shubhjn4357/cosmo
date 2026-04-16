---
name: conway-cloud
description: Operate Conway Cloud from AI agents, with Automaton-first defaults and HTTP fallback.
auto-activate: true
---

# Conway Cloud Operations

Use this skill for sandbox lifecycle, command execution, file operations, and service exposure on Conway Cloud.

## Precheck (Automaton-first)

Automatons are usually provisioned already. Validate first, then operate:

```bash
conway-terminal --version
curl https://api.conway.tech/health
```

If `CONWAY_API_KEY` is missing or invalid, use the fallback bootstrap path below.

## Preferred interface: MCP tools

Use MCP tools first when available:

- `sandbox_list`
- `sandbox_create`
- `sandbox_exec`
- `sandbox_read_file`
- `sandbox_write_file`
- `sandbox_expose_port`
- `sandbox_get_url`
- `sandbox_delete`
- Interactive: `sandbox_pty_create`, `sandbox_pty_write`, `sandbox_pty_read`, `sandbox_pty_close`

## HTTP fallback (direct API)

If MCP is unavailable, use direct HTTP calls.

Base URL:
```bash
https://api.conway.tech/v1
```

Auth header on every request:
```bash
Authorization: Bearer $CONWAY_API_KEY
```

## Execution pattern

1. Reuse existing sandbox when possible.
2. Create minimal resources first; scale up only if needed.
3. Execute in small, verifiable steps.
4. Expose ports only after health checks pass.
5. Tear down idle sandboxes.

## Guardrails

- Never leak `CONWAY_API_KEY`, wallet keys, or tokenized terminal URLs.
- Avoid destructive actions unless explicitly required.
- Keep operations resource-aware and cost-conscious.
