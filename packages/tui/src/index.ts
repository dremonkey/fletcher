/**
 * Fletcher TUI — interactive menu for development and maintenance.
 *
 * Main menu:
 *   - Start dev services  (env audit -> LiveKit + voice agent + mobile deploy)
 *   - Manage configuration (view/edit .env keys)
 *   - Install Claude Code skills (symlink skills -> .claude/commands/)
 *   - Deploy to mobile device (build APK -> push to emulator/device)
 *
 * Usage:
 *   fletcher tui   (or: bun dev)
 */

import * as p from "@clack/prompts";
import { loadEnv, cancelled } from "./env";
import { auditEnv } from "./audit";
import { manageConfiguration, confirmBeforeStart } from "./config";
import { manageSkills } from "./skills";
import { startServices, installShutdownHandler, generateToken } from "./services";
import { deployToDevice, startApkBuildInBackground } from "./mobile";
import { testRelay } from "./relay";

// Load .env into process.env on startup
for (const [k, v] of Object.entries(loadEnv())) {
  process.env[k] ??= v;
}

p.intro("Fletcher Dev Launcher");

while (true) {
  const action = await p.select({
    message: "What would you like to do?",
    options: [
      { value: "start", label: "Start dev services", hint: "LiveKit + voice agent + relay + optional mobile deploy" },
      { value: "config", label: "Manage configuration", hint: "view and edit environment variables" },
      { value: "skills", label: "Install Claude Code skills", hint: "symlink skills -> .claude/commands/" },
      { value: "deploy", label: "Deploy to mobile device", hint: "build APK and push to emulator/device" },
      { value: "relay", label: "Test relay", hint: "send a message through the ACP bridge" },
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

  if (action === "relay") {
    await testRelay();
    continue;
  }

  if (action === "deploy") {
    const flutterProc = await deployToDevice();
    if (flutterProc) {
      installShutdownHandler(); // after all clack prompts/spinners
      p.note("Flutter running with hot reload. Press 'r' to reload, Ctrl+C to stop.");
      await flutterProc.exited;
      break;
    }
    continue;
  }

  // action === "start" — launch services via docker-compose
  await auditEnv();
  await confirmBeforeStart();

  // Generate token early so it's in apps/mobile/.env before the APK build
  // reads it (fast — just signs a JWT, no server needed).
  await generateToken();

  // Start APK build in background while Docker services start up
  const apkBuildPromise = startApkBuildInBackground();
  if (apkBuildPromise) p.log.info("APK build started in background");

  await startServices();
  const flutterProc = await deployToDevice({ apkBuildPromise });

  // Install AFTER all @clack/prompts spinners and interactive prompts are
  // done.  Bun has a bug where adding then removing a signal handler (which
  // clack does on every spinner/prompt) silently disconnects earlier handlers
  // from native signal dispatch.  Re-registering here restores delivery.
  installShutdownHandler();

  if (flutterProc) {
    p.note("Voice agent + Flutter running. Press 'r' for hot reload, Ctrl+C to stop.", "Fletcher is ready");
    await flutterProc.exited;
  } else {
    p.note("Services running via docker compose. Press Ctrl+C to stop.", "Fletcher is ready");
    // Clack leaves stdin in raw mode with active listeners, which keeps
    // Bun's event loop busy-polling.  Tear it down so the loop can sleep.
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdin.removeAllListeners();
    process.stdin.unref();
    // Sleep in long intervals until SIGINT (signal handler calls process.exit).
    // A never-resolving Promise causes Bun's event loop to busy-spin;
    // an explicit timer gives it something real to block on.
    while (true) await Bun.sleep(2_147_483_647);
  }
  break;
}
