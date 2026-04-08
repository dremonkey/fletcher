import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Static regression guard: verify that the relay's graceful-shutdown loop
 * includes SIGHUP alongside SIGINT and SIGTERM.
 *
 * Importing index.ts directly would start the HTTP server and attempt a
 * LiveKit connection, making it unsuitable for unit tests. Instead we read
 * the source text, which is a stable and zero-side-effect way to assert the
 * signal list without spinning up infrastructure.
 */
describe("index.ts shutdown signal handlers", () => {
  const src = readFileSync(join(import.meta.dir, "index.ts"), "utf-8");

  test("registers SIGINT for graceful shutdown", () => {
    expect(src).toContain("SIGINT");
  });

  test("registers SIGTERM for graceful shutdown", () => {
    expect(src).toContain("SIGTERM");
  });

  test("registers SIGHUP for graceful shutdown (nix shell / terminal close)", () => {
    // SIGHUP is sent when a parent shell exits (e.g. nix develop session ends).
    // Without this handler the relay dies silently with no shutdown log.
    expect(src).toContain("SIGHUP");
  });

  test("all three signals appear in the same for-loop signal list", () => {
    // Confirm they are co-located, not spread across separate process.on calls.
    const loopMatch = src.match(/for\s*\(const signal of \[([^\]]+)\]/);
    expect(loopMatch).not.toBeNull();
    const loopContent = loopMatch![1];
    expect(loopContent).toContain("SIGINT");
    expect(loopContent).toContain("SIGTERM");
    expect(loopContent).toContain("SIGHUP");
  });
});
