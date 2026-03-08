# Task: `fletcher tui` CLI entrypoint

## Description

Replace `bun dev` with a proper `fletcher` CLI binary so the TUI is invoked via `fletcher tui` from anywhere in the repo (or system-wide after install).

## Current State

The TUI is started via a root `package.json` script:

```json
"dev": "bun run packages/tui/src/index.ts"
```

This works but:
- Requires being in the repo root
- Uses a generic `bun dev` name that doesn't communicate what it does
- No tab-completion or discoverability

## Implementation Plan

### 1. Add a `bin` entry to `packages/tui/package.json`

Register a `fletcher` binary that Bun can resolve:

```json
{
  "name": "@fletcher/tui",
  "bin": {
    "fletcher": "src/cli.ts"
  }
}
```

### 2. Create `packages/tui/src/cli.ts` — thin CLI dispatcher

A minimal entry point that parses subcommands and routes to the appropriate handler:

```typescript
#!/usr/bin/env bun

const [command] = process.argv.slice(2);

switch (command) {
  case "tui":
  case undefined:          // bare `fletcher` opens the TUI
    await import("./index.ts");
    break;
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
```

Keep it simple — no arg-parsing library needed for a single subcommand. Can be extended later (`fletcher token`, `fletcher deploy`, etc.) if needed.

### 3. Wire up workspace linking

Add to root `package.json`:

```json
"scripts": {
  "fletcher": "bun run packages/tui/src/cli.ts"
}
```

After `bun install`, the `fletcher` binary should be available via `bunx fletcher tui` or directly from `node_modules/.bin/fletcher`.

### 4. Update `bun dev` to delegate

Keep `bun dev` working as an alias for backwards compatibility:

```json
"dev": "bun run packages/tui/src/cli.ts tui"
```

## Checklist

- [x] Create `packages/tui/src/cli.ts` with subcommand routing
- [x] Add `bin` field to `packages/tui/package.json`
- [x] Update root `package.json` scripts (`dev`, `fletcher`)
- [ ] Verify `fletcher tui` works from repo root
- [ ] Verify bare `fletcher` (no subcommand) also opens the TUI
- [ ] Verify `bun dev` still works as before

## Success Criteria

- `fletcher tui` launches the interactive TUI from the repo root
- `bun dev` continues to work as an alias
