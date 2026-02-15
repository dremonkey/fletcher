/**
 * Unit tests to verify mock implementations work correctly.
 */
import { describe, expect, it, mock } from "bun:test";
import {
  createMockPluginApi,
  createMockRuntime,
  createMockLogger,
  createMockSTT,
  createMockTTS,
  createTestAudioStream,
  collectAudioChunks,
} from "../mocks/index.js";

describe("Mock Implementations", () => {
  describe("createMockPluginApi", () => {
    it("should create a mock API with all required methods", () => {
      const api = createMockPluginApi();

      expect(api.registerChannel).toBeDefined();
      expect(api.registerHook).toBeDefined();
      expect(api.registerHttpRoute).toBeDefined();
      expect(api.runtime).toBeDefined();
      expect(api.logger).toBeDefined();
    });

    it("should track registered channels", () => {
      const api = createMockPluginApi();

      api.registerChannel({
        plugin: {
          id: "test-channel",
          meta: { label: "Test" },
        },
      });

      expect(api._registeredChannels.size).toBe(1);
      expect(api._getChannel("test-channel")).toBeDefined();
      expect(api._getChannel("test-channel")?.id).toBe("test-channel");
    });

    it("should track registered hooks", async () => {
      const api = createMockPluginApi();
      const handler = mock(() => {});

      api.registerHook("message:send", handler);

      expect(api._registeredHooks.get("message:send")).toContain(handler);

      await api._triggerHook("message:send", { text: "hello" });
      expect(handler).toHaveBeenCalledWith({ text: "hello" });
    });

    it("should accept custom config", () => {
      const api = createMockPluginApi({
        config: {
          channels: {
            livekit: {
              url: "ws://custom:7880",
              apiKey: "custom-key",
            },
          },
        },
      });

      expect(api.config.channels?.livekit?.url).toBe("ws://custom:7880");
    });
  });

  describe("createMockRuntime", () => {
    it("should track sent messages", async () => {
      const runtime = createMockRuntime();

      await runtime.sendMessage("conv-123", "Hello world");

      expect(runtime._sentMessages).toHaveLength(1);
      expect(runtime._sentMessages[0]).toEqual({
        conversationId: "conv-123",
        text: "Hello world",
        sender: undefined,
      });
    });

    it("should support event emission", () => {
      const runtime = createMockRuntime();
      const handler = mock(() => {});

      runtime._onEvent("message:send", handler);
      runtime._emitEvent("message:send", { text: "test" });

      expect(handler).toHaveBeenCalledWith({ text: "test" });
    });

    it("should simulate brain responses", () => {
      const runtime = createMockRuntime();
      const handler = mock(() => {});

      runtime._onEvent("message:send", handler);
      runtime._simulateBrainResponse("conv-123", "I am the agent");

      expect(handler).toHaveBeenCalledWith({
        conversationId: "conv-123",
        text: "I am the agent",
      });
    });
  });

  describe("createMockLogger", () => {
    it("should capture log calls", () => {
      const logger = createMockLogger();

      logger.info("Test message", { key: "value" });
      logger.error("Error occurred");

      expect(logger._logs).toHaveLength(2);
      expect(logger._logs[0]).toEqual({
        level: "info",
        message: "Test message",
        args: [{ key: "value" }],
      });
    });
  });

  describe("createMockSTT", () => {
    it("should track audio chunks", async () => {
      const stt = createMockSTT();
      const audioStream = createTestAudioStream(3, 512);

      const transcriptions: unknown[] = [];
      for await (const event of stt.transcribe(audioStream)) {
        transcriptions.push(event);
      }

      expect(stt._calls).toHaveLength(1);
      expect(stt._calls[0]).toHaveLength(3);
      expect(stt._calls[0][0].length).toBe(512);
    });

    it("should yield simulated transcriptions", async () => {
      const stt = createMockSTT();

      stt._simulateFinal("Hello world");
      stt._simulatePartial("How are");

      const results: unknown[] = [];
      for await (const event of stt.transcribe(createTestAudioStream(1))) {
        results.push(event);
      }

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        text: "Hello world",
        is_final: true,
        speech_final: true,
      });
      expect(results[1]).toMatchObject({
        text: "How are",
        is_final: false,
        speech_final: false,
      });
    });
  });

  describe("createMockTTS", () => {
    it("should track synthesis calls", async () => {
      const tts = createMockTTS();

      await collectAudioChunks(tts.synthesize("Hello world", { voiceId: "voice-1" }));

      expect(tts._calls).toHaveLength(1);
      expect(tts._calls[0]).toEqual({
        text: "Hello world",
        options: { voiceId: "voice-1" },
      });
    });

    it("should yield audio chunks", async () => {
      const tts = createMockTTS();

      const chunks = await collectAudioChunks(tts.synthesize("Test"));

      expect(chunks).toHaveLength(2);
      expect(chunks[0].length).toBe(1024);
    });

    it("should simulate errors", async () => {
      const tts = createMockTTS();

      tts._simulateError(new Error("API limit exceeded"));

      expect(async () => {
        await collectAudioChunks(tts.synthesize("Test"));
      }).toThrow("API limit exceeded");
    });
  });
});
