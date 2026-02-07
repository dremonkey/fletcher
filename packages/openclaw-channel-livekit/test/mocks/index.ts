/**
 * Test mocks index - re-exports all mock utilities.
 */
export { createMockPluginApi, type MockPluginApi, type MockChannelPlugin } from "./openclaw-api.js";
export { createMockRuntime, type MockRuntime, type MockMessage, type MockConversation } from "./runtime.js";
export { createMockLogger, type MockLogger } from "./logger.js";
export { createMockSTT, createTestAudioStream, type MockSTTProvider, type TranscriptEvent } from "./stt.js";
export { createMockTTS, collectAudioChunks, type MockTTSProvider, type TTSSynthesisOptions } from "./tts.js";
