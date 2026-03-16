import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { OpenClawProvider } from "./openclaw-provider";
import type { SubAgentInfo } from "./types";

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: function () { return this; },
} as any;

function createProvider() {
  return new OpenClawProvider({
    sessionId: "test-session",
    cwd: "/tmp",
    logger: noopLogger,
  });
}

describe("OpenClawProvider", () => {
  let provider: OpenClawProvider;
  let snapshots: SubAgentInfo[][];

  beforeEach(() => {
    provider = createProvider();
    snapshots = [];
    provider.start((agents) => snapshots.push([...agents]));
  });

  afterEach(() => {
    provider.stop();
  });

  it("starts with empty snapshot", () => {
    expect(provider.getSnapshot()).toEqual([]);
  });

  it("tracks tool_call_begin for Task tool", () => {
    provider.handleSessionUpdate({
      update: {
        sessionUpdate: "tool_call_begin",
        tool_name: "Task",
        tool_call_id: "tc-1",
        input: { prompt: "Search for auth patterns" },
      },
    });

    expect(snapshots.length).toBe(1);
    const agents = snapshots[0];
    expect(agents.length).toBe(1);
    expect(agents[0].id).toBe("tc-1");
    expect(agents[0].task).toBe("Search for auth patterns");
    expect(agents[0].status).toBe("running");
  });

  it("completes on tool_call_end", () => {
    provider.handleSessionUpdate({
      update: {
        sessionUpdate: "tool_call_begin",
        tool_name: "Task",
        tool_call_id: "tc-2",
        input: { prompt: "Fix bug" },
      },
    });

    provider.handleSessionUpdate({
      update: {
        sessionUpdate: "tool_call_end",
        tool_call_id: "tc-2",
        output: "Bug fixed successfully.",
      },
    });

    expect(snapshots.length).toBe(2);
    const agents = snapshots[1];
    expect(agents.length).toBe(1);
    expect(agents[0].status).toBe("completed");
    expect(agents[0].completedAt).not.toBeNull();
    expect(agents[0].lastOutput).toBe("Bug fixed successfully.");
  });

  it("marks errored on tool_call_end with error", () => {
    provider.handleSessionUpdate({
      update: {
        sessionUpdate: "tool_call_begin",
        tool_name: "Task",
        tool_call_id: "tc-3",
        input: { prompt: "Do something" },
      },
    });

    provider.handleSessionUpdate({
      update: {
        sessionUpdate: "tool_call_end",
        tool_call_id: "tc-3",
        error: "timeout exceeded",
      },
    });

    const agents = snapshots[snapshots.length - 1];
    expect(agents[0].status).toBe("error");
  });

  it("ignores non-Task tool calls", () => {
    provider.handleSessionUpdate({
      update: {
        sessionUpdate: "tool_call_begin",
        tool_name: "Read",
        tool_call_id: "tc-4",
        input: { path: "/tmp/file.txt" },
      },
    });

    expect(snapshots.length).toBe(0);
  });

  it("handles subagent_start/subagent_end events", () => {
    provider.handleSessionUpdate({
      update: {
        sessionUpdate: "subagent_start",
        agent_id: "sa-1",
        task: "Explore the codebase",
        model: "claude-sonnet-4-6",
      },
    });

    expect(snapshots.length).toBe(1);
    expect(snapshots[0][0].id).toBe("sa-1");
    expect(snapshots[0][0].model).toBe("claude-sonnet-4-6");

    provider.handleSessionUpdate({
      update: {
        sessionUpdate: "subagent_end",
        agent_id: "sa-1",
        output: "Found 5 relevant files.",
      },
    });

    const final = snapshots[snapshots.length - 1];
    expect(final[0].status).toBe("completed");
    expect(final[0].lastOutput).toBe("Found 5 relevant files.");
  });

  it("tracks multiple concurrent sub-agents", () => {
    provider.handleSessionUpdate({
      update: {
        sessionUpdate: "tool_call_begin",
        tool_name: "Task",
        tool_call_id: "tc-a",
        input: { prompt: "Task A" },
      },
    });

    provider.handleSessionUpdate({
      update: {
        sessionUpdate: "tool_call_begin",
        tool_name: "Task",
        tool_call_id: "tc-b",
        input: { prompt: "Task B" },
      },
    });

    const agents = snapshots[snapshots.length - 1];
    expect(agents.length).toBe(2);
    expect(agents.map((a) => a.id).sort()).toEqual(["tc-a", "tc-b"]);
  });

  it("ignores malformed updates", () => {
    provider.handleSessionUpdate(null);
    provider.handleSessionUpdate({});
    provider.handleSessionUpdate({ update: "not-an-object" });
    provider.handleSessionUpdate({ update: {} });

    expect(snapshots.length).toBe(0);
  });

  it("extracts task from various input field names", () => {
    for (const [field, value] of [
      ["prompt", "From prompt"],
      ["task", "From task"],
      ["description", "From description"],
    ] as const) {
      provider.handleSessionUpdate({
        update: {
          sessionUpdate: "tool_call_begin",
          tool_name: "Task",
          tool_call_id: `tc-${field}`,
          input: { [field]: value },
        },
      });
    }

    const agents = provider.getSnapshot();
    const tasks = agents.map((a) => a.task).sort();
    expect(tasks).toEqual(["From description", "From prompt", "From task"]);
  });
});
