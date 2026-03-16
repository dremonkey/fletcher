import { describe, expect, it, beforeEach } from "bun:test";
import {
  registerSubAgentProvider,
  createSubAgentProvider,
  getRegisteredProviders,
} from "./registry";
import type { SubAgentProvider } from "./provider";
import type { SubAgentProviderOptions } from "./registry";
import type { SubAgentInfo } from "./types";

/** Minimal stub provider for registry tests. */
class StubProvider implements SubAgentProvider {
  readonly name: string;
  constructor(public opts: SubAgentProviderOptions) {
    this.name = "stub";
  }
  start() {}
  stop() {}
  getSnapshot(): SubAgentInfo[] {
    return [];
  }
}

// The registry is module-level state, so tests here validate the public API.
// We register unique names per test to avoid cross-test pollution.

describe("sub-agent registry", () => {
  it("registers and creates a provider", () => {
    registerSubAgentProvider("test-backend-1", (opts) => new StubProvider(opts));

    const opts: SubAgentProviderOptions = {
      sessionId: "sess-123",
      cwd: "/tmp",
      logger: console as any,
    };
    const provider = createSubAgentProvider("test-backend-1", opts);

    expect(provider).not.toBeNull();
    expect(provider!.name).toBe("stub");
    expect((provider as StubProvider).opts.sessionId).toBe("sess-123");
  });

  it("returns null for unknown command", () => {
    const provider = createSubAgentProvider("nonexistent", {
      sessionId: "s",
      cwd: "/",
      logger: console as any,
    });
    expect(provider).toBeNull();
  });

  it("lists registered providers", () => {
    registerSubAgentProvider("test-backend-2", (opts) => new StubProvider(opts));
    const names = getRegisteredProviders();
    expect(names).toContain("test-backend-2");
  });
});
