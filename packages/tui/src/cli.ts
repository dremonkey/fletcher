#!/usr/bin/env bun

const [command] = process.argv.slice(2);

switch (command) {
  case "tui":
  case undefined: // bare `fletcher` opens the TUI
    await import("./index.ts");
    break;
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
