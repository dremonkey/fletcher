#!/usr/bin/env bun
/**
 * Fletcher TUI — single entry point for development and maintenance.
 *
 * Main menu:
 *   - Start dev services  (env audit -> LiveKit + voice agent + mobile deploy)
 *   - Manage configuration (view/edit .env keys)
 *   - Install Claude Code skills (symlink skills -> .claude/commands/)
 *   - Deploy to mobile device (build APK -> push to emulator/device)
 *
 * Usage:
 *   bun dev
 */

import * as p from "@clack/prompts";
import { loadEnv, cancelled } from "./env";
import { auditEnv } from "./audit";
import { manageConfiguration, confirmBeforeStart } from "./config";
import { manageSkills } from "./skills";
import { startServices, installShutdownHandler, pipeStream } from "./services";
import { deployToDevice } from "./mobile";

// Load .env into process.env on startup
for (const [k, v] of Object.entries(loadEnv())) {
  process.env[k] ??= v;
}

p.intro("Fletcher Dev Launcher");

while (true) {
  const action = await p.select({
    message: "What would you like to do?",
    options: [
      { value: "start", label: "Start dev services", hint: "LiveKit + voice agent + optional mobile deploy" },
      { value: "config", label: "Manage configuration", hint: "view and edit environment variables" },
      { value: "skills", label: "Install Claude Code skills", hint: "symlink skills -> .claude/commands/" },
      { value: "deploy", label: "Deploy to mobile device", hint: "build APK and push to emulator/device" },
      { value: "quit", label: "Quit" },
    ],
  });
  if (p.isCancel(action)) cancelled();

  if (action === "quit") {
    p.outro("Goodbye.");
    process.exit(0);
  }

  if (action === "config") {
    await manageConfiguration();
    continue;
  }

  if (action === "skills") {
    await manageSkills();
    continue;
  }

  if (action === "deploy") {
    const flutterProc = await deployToDevice();
    if (flutterProc) {
      installShutdownHandler(flutterProc);
      p.note("Flutter running with hot reload. Press 'r' to reload, Ctrl+C to stop.");
      await flutterProc.exited;
      p.outro("Flutter exited.");
      break;
    }
    continue;
  }

  // action === "start" — launch services
  await auditEnv();
  await confirmBeforeStart();

  const agent = await startServices();
  installShutdownHandler(agent);
  const flutterProc = await deployToDevice();

  if (flutterProc) {
    p.note("Voice agent + Flutter running. Press 'r' for hot reload, Ctrl+C to stop.", "Fletcher is ready");
  } else {
    p.note("Voice agent is running. Press Ctrl+C to stop.", "Fletcher is ready");
  }

  pipeStream(agent.stdout as ReadableStream<Uint8Array>, process.stdout);
  pipeStream(agent.stderr as ReadableStream<Uint8Array>, process.stderr);

  await agent.exited;
  p.outro("Voice agent exited.");
  break;
}
