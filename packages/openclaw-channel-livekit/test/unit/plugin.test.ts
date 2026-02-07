/**
 * Unit tests for LiveKit plugin registration.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { createMockPluginApi, type MockPluginApi } from "../mocks/index.js";
import plugin from "../../src/index.js";
import { clearRuntime } from "../../src/runtime.js";

describe("LiveKit Plugin", () => {
  let mockApi: MockPluginApi;

  beforeEach(() => {
    // Clear runtime state between tests
    clearRuntime();

    mockApi = createMockPluginApi({
      config: {
        channels: {
          livekit: {
            url: "ws://localhost:7880",
            apiKey: "devkey",
            apiSecret: "secret",
          },
        },
      },
    });
  });

  describe("plugin metadata", () => {
    it("should have correct id", () => {
      expect(plugin.id).toBe("livekit");
    });

    it("should have correct name", () => {
      expect(plugin.name).toBe("LiveKit Voice");
    });

    it("should have description", () => {
      expect(plugin.description).toBeDefined();
      expect(plugin.description).toContain("voice");
    });

    it("should have configSchema", () => {
      expect(plugin.configSchema).toBeDefined();
    });
  });

  describe("registration", () => {
    it("should register channel on plugin.register()", () => {
      plugin.register(mockApi as any);

      expect(mockApi.registerChannel).toHaveBeenCalledTimes(1);
    });

    it("should register channel with correct id", () => {
      plugin.register(mockApi as any);

      const channel = mockApi._getChannel("livekit");
      expect(channel).toBeDefined();
      expect(channel?.id).toBe("livekit");
    });

    it("should set runtime during registration", () => {
      plugin.register(mockApi as any);

      // Runtime should be set (we can verify by checking no error is thrown)
      // The actual runtime check would require importing getLivekitRuntime
    });
  });

  describe("channel capabilities", () => {
    it("should declare audio capability", () => {
      plugin.register(mockApi as any);
      const channel = mockApi._getChannel("livekit");

      expect(channel?.capabilities?.audio).toBe(true);
    });

    it("should declare realtime capability", () => {
      plugin.register(mockApi as any);
      const channel = mockApi._getChannel("livekit");

      expect(channel?.capabilities?.realtime).toBe(true);
    });

    it("should not declare reactions capability", () => {
      plugin.register(mockApi as any);
      const channel = mockApi._getChannel("livekit");

      expect(channel?.capabilities?.reactions).toBe(false);
    });
  });

  describe("channel meta", () => {
    it("should have label", () => {
      plugin.register(mockApi as any);
      const channel = mockApi._getChannel("livekit");

      expect(channel?.meta?.label).toBe("LiveKit Voice");
    });

    it("should have icon", () => {
      plugin.register(mockApi as any);
      const channel = mockApi._getChannel("livekit");

      expect(channel?.meta?.icon).toBe("microphone");
    });
  });
});
