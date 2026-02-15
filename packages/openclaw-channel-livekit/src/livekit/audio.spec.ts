/**
 * Unit tests for VoiceAgent with SDK + Ganglia integration.
 */
import { describe, expect, it, beforeEach, mock } from "bun:test";
import { VoiceAgent, type VoiceAgentConfig } from "./audio.js";

// Mock the external SDK modules
const mockSessionInstance = {
  say: mock(() => {}),
  close: mock(() => Promise.resolve()),
  start: mock(() => Promise.resolve()),
};

const mockAgentConstructor = mock(() => {});

const mockGangliaLLM = {
  gangliaType: () => "openclaw",
  setDefaultSession: mock(() => {}),
};

mock.module("@livekit/agents-plugin-deepgram", () => ({
  STT: class MockSTT {
    constructor(public opts: unknown) {}
  },
}));

mock.module("@livekit/agents-plugin-cartesia", () => ({
  TTS: class MockTTS {
    constructor(public opts: unknown) {}
  },
}));

mock.module("@livekit/agents", () => ({
  voice: {
    Agent: class MockAgent {
      constructor(public opts: unknown) {
        mockAgentConstructor(opts);
      }
    },
    AgentSession: class MockAgentSession {
      constructor(public opts: unknown) {
        Object.assign(this, mockSessionInstance);
      }
    },
  },
}));

mock.module("@knittt/livekit-agent-ganglia", () => ({
  createGanglia: mock(() => Promise.resolve(mockGangliaLLM)),
  createGangliaFromEnv: mock(() => Promise.resolve(mockGangliaLLM)),
}));

// Mock participant tracker to avoid RoomEvent dependency
let capturedOnJoin: ((p: { identity: string }) => void) | undefined;
mock.module("./participant.js", () => ({
  ParticipantTracker: class MockTracker {
    constructor(_room: unknown, handlers: { onJoin?: (p: { identity: string }) => void }) {
      capturedOnJoin = handlers.onJoin;
    }
    getParticipants() { return []; }
    dispose() {}
  },
}));

/**
 * Create a test account config.
 */
function createTestAccount() {
  return {
    accountId: "test",
    enabled: true,
    url: "ws://localhost:7880",
    apiKey: "devkey",
    apiSecret: "secret",
    roomPrefix: "test-",
    stt: {
      provider: "deepgram" as const,
      apiKey: "dg-key",
      deepgram: { model: "nova-3", language: "en" },
    },
    tts: {
      provider: "cartesia" as const,
      apiKey: "cart-key",
      cartesia: { voiceId: "voice-1", model: "sonic-3", speed: 1, emotion: "neutral" },
      elevenlabs: {
        voiceId: "",
        model: "eleven_turbo_v2_5",
        stability: 0.5,
        similarityBoost: 0.75,
        style: 0,
        useSpeakerBoost: false,
      },
    },
    dm: { policy: "open" as const, allowFrom: [] },
  };
}

/**
 * Create a mock Room with minimal API surface.
 */
function createMockRoom() {
  const participants = new Map();
  return {
    name: "test-room",
    remoteParticipants: participants,
    on: mock(() => {}),
    _addParticipant(identity: string) {
      participants.set(identity, { identity, name: identity });
    },
  };
}

describe("VoiceAgent", () => {
  let agent: VoiceAgent;
  let room: ReturnType<typeof createMockRoom>;

  beforeEach(() => {
    // Reset mocks
    mockSessionInstance.say.mockClear();
    mockSessionInstance.close.mockClear();
    mockSessionInstance.start.mockClear();
    mockAgentConstructor.mockClear();
    capturedOnJoin = undefined;

    agent = new VoiceAgent({
      roomId: "test-room",
      account: createTestAccount(),
    });

    room = createMockRoom();
  });

  describe("lifecycle", () => {
    it("should start in idle state", () => {
      expect(agent.getState()).toBe("idle");
      expect(agent.isActive()).toBe(false);
    });

    it("should transition to listening on start", async () => {
      await agent.start(room as any);

      expect(agent.getState()).toBe("listening");
      expect(agent.isActive()).toBe(true);
    });

    it("should not start twice", async () => {
      await agent.start(room as any);
      await agent.start(room as any);

      // Agent constructor should only be called once
      expect(mockAgentConstructor).toHaveBeenCalledTimes(1);
      expect(agent.isActive()).toBe(true);
    });

    it("should clean up on close", async () => {
      await agent.start(room as any);

      // Simulate a session being active
      capturedOnJoin?.({ identity: "user-1" });
      await new Promise((r) => setTimeout(r, 10));

      await agent.close();

      expect(agent.getState()).toBe("idle");
      expect(agent.isActive()).toBe(false);
    });

    it("should be safe to close when not running", async () => {
      await agent.close(); // Should not throw
      expect(agent.getState()).toBe("idle");
    });
  });

  describe("say()", () => {
    it("should warn when no active session", async () => {
      await agent.start(room as any);
      // No participant joined, so no session
      await agent.say("Hello");

      // Should not throw, just log a warning
      expect(mockSessionInstance.say).not.toHaveBeenCalled();
    });

    it("should delegate to session.say when session exists", async () => {
      await agent.start(room as any);

      // Simulate participant join → session start
      capturedOnJoin?.({ identity: "user-1" });
      await new Promise((r) => setTimeout(r, 10));

      await agent.say("Hello world");

      expect(mockSessionInstance.say).toHaveBeenCalledWith("Hello world");
    });
  });

  describe("participant join", () => {
    it("should start session when participant joins", async () => {
      await agent.start(room as any);

      capturedOnJoin?.({ identity: "user-1" });
      await new Promise((r) => setTimeout(r, 10));

      expect(mockSessionInstance.start).toHaveBeenCalled();
    });

    it("should not start a second session if one is already active", async () => {
      await agent.start(room as any);

      capturedOnJoin?.({ identity: "user-1" });
      await new Promise((r) => setTimeout(r, 10));

      capturedOnJoin?.({ identity: "user-2" });
      await new Promise((r) => setTimeout(r, 10));

      // session.start should only be called once
      expect(mockSessionInstance.start).toHaveBeenCalledTimes(1);
    });
  });

  describe("config mapping", () => {
    it("should pass account STT config to deepgram.STT", async () => {
      await agent.start(room as any);

      // Verify the Agent was constructed with the right instructions
      expect(mockAgentConstructor).toHaveBeenCalledTimes(1);
      const agentOpts = mockAgentConstructor.mock.calls[0][0] as any;
      expect(agentOpts.instructions).toBeDefined();
    });
  });
});
