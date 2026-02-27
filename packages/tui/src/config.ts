import * as p from "@clack/prompts";
import { env, setKey, cancelled } from "./env";
import { auditLiveKit, DEFAULT_ROOM } from "./audit";

export function showConfig(): void {
  const mask = (v: string | undefined) => (v ? "***" + v.slice(-4) : "(not set)");

  p.note(
    [
      `LiveKit URL:    ${env("LIVEKIT_URL") ?? "(not set)"}`,
      `LiveKit Key:    ${mask(env("LIVEKIT_API_KEY"))}`,
      `LiveKit Room:   ${env("LIVEKIT_ROOM") ?? "(not set)"}`,
      `Ganglia:        ${env("GANGLIA_TYPE") ?? "(not set)"}`,
      `Deepgram:       ${mask(env("DEEPGRAM_API_KEY"))}`,
      `Cartesia:       ${mask(env("CARTESIA_API_KEY"))}`,
    ].join("\n"),
    "Configuration",
  );
}

export async function modifyConfig(): Promise<void> {
  const key = await p.select({
    message: "Which key to change?",
    options: [
      { value: "livekit", label: "LiveKit server" },
      { value: "LIVEKIT_ROOM", label: "LiveKit room name" },
      { value: "GANGLIA_TYPE", label: "Ganglia backend" },
      { value: "OPENCLAW_API_KEY", label: "OpenClaw gateway token" },
      { value: "DEEPGRAM_API_KEY", label: "Deepgram API key (speech-to-text)" },
      { value: "CARTESIA_API_KEY", label: "Cartesia API key (text-to-speech)" },
    ],
  });
  if (p.isCancel(key)) return;

  if (key === "livekit") {
    // Clear existing keys so auditLiveKit re-prompts
    delete process.env.LIVEKIT_URL;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    await auditLiveKit();
  } else if (key === "LIVEKIT_ROOM") {
    const value = await p.text({
      message: "Room name:",
      initialValue: env("LIVEKIT_ROOM") || DEFAULT_ROOM,
    });
    if (p.isCancel(value)) return;
    setKey("LIVEKIT_ROOM", value);
  } else if (key === "GANGLIA_TYPE") {
    const backend = await p.select({
      message: "Which brain backend?",
      options: [
        { value: "nanoclaw", label: "Nanoclaw", hint: "single-user, localhost" },
        { value: "openclaw", label: "OpenClaw", hint: "multi-user, requires API key" },
      ],
    });
    if (p.isCancel(backend)) return;
    setKey("GANGLIA_TYPE", backend as string);
  } else {
    const value = await p.password({ message: `Enter new value:` });
    if (p.isCancel(value)) return;
    setKey(key as string, value);
  }
}

export async function manageConfiguration(): Promise<void> {
  while (true) {
    showConfig();

    const action = await p.select({
      message: "Configuration",
      options: [
        { value: "back", label: "Back to main menu" },
        { value: "modify", label: "Edit a key" },
      ],
    });
    if (p.isCancel(action)) return;
    if (action === "back") return;
    await modifyConfig();
  }
}

export async function confirmBeforeStart(): Promise<void> {
  while (true) {
    showConfig();

    const action = await p.select({
      message: "Ready to start?",
      options: [
        { value: "start", label: "Start services" },
        { value: "modify", label: "Edit a key first" },
      ],
    });
    if (p.isCancel(action)) cancelled();
    if (action === "start") return;
    await modifyConfig();
  }
}
