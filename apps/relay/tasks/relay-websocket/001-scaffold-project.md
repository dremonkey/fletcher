# 001: Scaffold Project

**Status:** Not Started
**Depends on:** —
**Blocks:** 002, 003

## Objective

Initialize the `fletcher-relay` Bun project with dependencies, TypeScript config, and project CLAUDE.md.

## Steps

1. Run `bun init` in `apps/relay` with TypeScript
2. Install dependencies:
   - `bun add @anthropic-ai/claude-agent-sdk`
3. Configure `tsconfig.json`:
   - `strict: true`
   - `target: "ESNext"`
   - `module: "ESNext"`
   - `moduleResolution: "bundler"`
   - `outDir: "./dist"`
   - `rootDir: "./src"`
4. Create directory structure:
   - `src/rpc/`
   - `src/session/`
   - `src/http/`
   - `test/`
5. Create `CLAUDE.md` with project conventions:
   - Bun runtime, TypeScript strict
   - JSON-RPC 2.0 over WebSocket protocol
   - Agent SDK integration notes
   - `bun run src/index.ts` to start, `bun test` to test
6. Initialize git repo and make initial commit

## Acceptance Criteria

- `bun install` succeeds with no errors
- `tsc --noEmit` passes (once stub files exist)
- Directory structure matches the EPIC file layout
- CLAUDE.md exists with project conventions
