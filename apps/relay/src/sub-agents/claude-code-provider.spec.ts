import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  computeProjectId,
  parseAgentJSONL,
  ClaudeCodeProvider,
} from "./claude-code-provider";
import type { SubAgentInfo } from "./types";

// ---------------------------------------------------------------------------
// Unit: computeProjectId
// ---------------------------------------------------------------------------

describe("computeProjectId", () => {
  it("replaces slashes with dashes", () => {
    expect(computeProjectId("/home/user/code/project")).toBe(
      "-home-user-code-project",
    );
  });

  it("handles root path", () => {
    expect(computeProjectId("/")).toBe("-");
  });
});

// ---------------------------------------------------------------------------
// Unit: parseAgentJSONL
// ---------------------------------------------------------------------------

describe("parseAgentJSONL", () => {
  it("returns running for empty content", () => {
    const info = parseAgentJSONL("abc123", "");
    expect(info).not.toBeNull();
    expect(info!.id).toBe("abc123");
    expect(info!.status).toBe("running");
    expect(info!.task).toBe("(starting...)");
  });

  it("parses a running agent with user message", () => {
    const lines = [
      JSON.stringify({
        type: "user",
        timestamp: "2026-03-16T10:00:00.000Z",
        message: {
          role: "user",
          content: "Fix the login bug in auth.ts",
        },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-03-16T10:00:01.000Z",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "I'll look at auth.ts now." }],
          stop_reason: "tool_use",
          usage: { output_tokens: 50 },
        },
      }),
    ];

    const info = parseAgentJSONL("abc123", lines.join("\n"));
    expect(info).not.toBeNull();
    expect(info!.task).toBe("Fix the login bug in auth.ts");
    expect(info!.status).toBe("running");
    expect(info!.model).toBe("claude-sonnet-4-6");
    expect(info!.tokens).toBe(50);
    expect(info!.lastOutput).toBe("I'll look at auth.ts now.");
    expect(info!.completedAt).toBeNull();
  });

  it("parses a completed agent", () => {
    const lines = [
      JSON.stringify({
        type: "user",
        timestamp: "2026-03-16T10:00:00.000Z",
        message: { role: "user", content: "Search for tests" },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-03-16T10:00:05.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Found 3 test files." }],
          stop_reason: "end_turn",
          usage: { output_tokens: 20 },
        },
      }),
    ];

    const info = parseAgentJSONL("def456", lines.join("\n"));
    expect(info!.status).toBe("completed");
    expect(info!.completedAt).not.toBeNull();
    expect(info!.durationMs).toBe(5000);
  });

  it("extracts task from array content", () => {
    const lines = [
      JSON.stringify({
        type: "user",
        timestamp: "2026-03-16T10:00:00.000Z",
        message: {
          role: "user",
          content: [
            { type: "text", text: "Part one. " },
            { type: "text", text: "Part two." },
          ],
        },
      }),
    ];

    const info = parseAgentJSONL("ghi789", lines.join("\n"));
    expect(info!.task).toBe("Part one. Part two.");
  });

  it("truncates long task descriptions", () => {
    const longText = "x".repeat(200);
    const lines = [
      JSON.stringify({
        type: "user",
        timestamp: "2026-03-16T10:00:00.000Z",
        message: { role: "user", content: longText },
      }),
    ];

    const info = parseAgentJSONL("jkl012", lines.join("\n"));
    expect(info!.task.length).toBeLessThanOrEqual(120);
    expect(info!.task).toEndWith("...");
  });

  it("handles malformed JSONL lines gracefully", () => {
    const lines = [
      "not json at all",
      JSON.stringify({
        type: "user",
        timestamp: "2026-03-16T10:00:00.000Z",
        message: { role: "user", content: "Real task" },
      }),
    ];

    const info = parseAgentJSONL("mno345", lines.join("\n"));
    expect(info!.task).toBe("Real task");
  });

  it("accumulates tokens from multiple assistant messages", () => {
    const lines = [
      JSON.stringify({
        type: "user",
        timestamp: "2026-03-16T10:00:00.000Z",
        message: { role: "user", content: "Do things" },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-03-16T10:00:01.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Step 1" }],
          stop_reason: "tool_use",
          usage: { output_tokens: 100 },
        },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-03-16T10:00:02.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Step 2 done." }],
          stop_reason: "end_turn",
          usage: { output_tokens: 50 },
        },
      }),
    ];

    const info = parseAgentJSONL("pqr678", lines.join("\n"));
    expect(info!.tokens).toBe(150);
    expect(info!.lastOutput).toBe("Step 2 done.");
  });
});

// ---------------------------------------------------------------------------
// Integration: ClaudeCodeProvider with real filesystem
// ---------------------------------------------------------------------------

describe("ClaudeCodeProvider", () => {
  let tmpDir: string;
  let subagentsDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "fletcher-sub-agent-test-"));
    subagentsDir = join(tmpDir, "subagents");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  /** Create a provider that points at our test directory. */
  function createProvider(): ClaudeCodeProvider {
    const provider = new ClaudeCodeProvider({
      sessionId: "test-session",
      cwd: "/tmp",
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
        child: () => ({
          info: () => {},
          warn: () => {},
          error: () => {},
          debug: () => {},
          child: function () { return this; },
        }),
      } as any,
    });
    // Override the computed dir to point at our temp directory
    (provider as any).dir = subagentsDir;
    return provider;
  }

  it("returns empty snapshot when directory does not exist", async () => {
    const provider = createProvider();
    expect(provider.getSnapshot()).toEqual([]);
    provider.stop();
  });

  it("scans existing agent files on start", async () => {
    // Create the subagents dir with a file
    await mkdir(subagentsDir, { recursive: true });
    await writeFile(
      join(subagentsDir, "agent-abc123.jsonl"),
      JSON.stringify({
        type: "user",
        timestamp: "2026-03-16T10:00:00.000Z",
        message: { role: "user", content: "Fix the bug" },
      }),
    );

    const provider = createProvider();
    const snapshots: SubAgentInfo[][] = [];
    provider.start((agents) => snapshots.push(agents));

    // Wait for async scan to complete
    await new Promise((r) => setTimeout(r, 100));

    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    const agents = snapshots[snapshots.length - 1];
    expect(agents.length).toBe(1);
    expect(agents[0].id).toBe("abc123");
    expect(agents[0].task).toBe("Fix the bug");
    expect(agents[0].status).toBe("running");

    provider.stop();
  });

  it("detects new agent files via watcher", async () => {
    await mkdir(subagentsDir, { recursive: true });

    const provider = createProvider();
    const snapshots: SubAgentInfo[][] = [];
    provider.start((agents) => snapshots.push(agents));

    // Wait for initial scan
    await new Promise((r) => setTimeout(r, 100));
    const initialCount = snapshots.length;

    // Add a new agent file
    await writeFile(
      join(subagentsDir, "agent-def456.jsonl"),
      JSON.stringify({
        type: "user",
        timestamp: "2026-03-16T10:00:00.000Z",
        message: { role: "user", content: "New task" },
      }),
    );

    // Wait for debounced scan (500ms debounce + buffer)
    await new Promise((r) => setTimeout(r, 800));

    expect(snapshots.length).toBeGreaterThan(initialCount);
    const latest = snapshots[snapshots.length - 1];
    expect(latest.some((a) => a.id === "def456")).toBe(true);

    provider.stop();
  });

  it("cleans up on stop", async () => {
    await mkdir(subagentsDir, { recursive: true });

    const provider = createProvider();
    provider.start(() => {});

    await new Promise((r) => setTimeout(r, 100));

    provider.stop();

    // Should not throw when stopping
    expect((provider as any).watcher).toBeNull();
    expect((provider as any).pollTimer).toBeNull();
  });
});
