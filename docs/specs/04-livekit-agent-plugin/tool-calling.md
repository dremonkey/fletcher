# Technical Specification: Tool-Calling Support in Fletcher Brain Bridge

**Status:** Draft / Phase 3 Proposal  
**Project:** `@knittt/livekit-agent-openclaw` (Fletcher Brain Bridge)  
**Target Latency:** < 1.5s (Turn-Around Time)

## 1. Objectives

The goal of Phase 3 is to enable **Tool-Calling** within the Fletcher Brain Bridge. This allows the LiveKit agent to leverage OpenClaw's extensive "Skills" ecosystem (e.g., searching the web, checking calendar, interacting with local files) while maintaining the real-time performance expected of a voice-first interface.

Key objectives:
1.  **Architecture Mapping:** Define how LiveKit's `FunctionCall` system interfaces with OpenClaw's Tool execution.
2.  **Tool Discovery:** Expose OpenClaw's gateway-resident tools to the LiveKit LLM interface.
3.  **Real-time Audio Integrity:** Ensure tool execution doesn't cause audio stutter or excessive silence (latency management).
4.  **Security:** Implement a permission model for voice-invocable tools.
5.  **Implementation Path:** Specific changes for `src/llm.ts` and `src/client.ts`.

---

## 2. Mapping Architecture

LiveKit Agents use an asynchronous tool execution flow where the LLM emits a `FunctionCall` delta, the Agent Framework executes it, and the result is appended back to the `ChatContext` as a `TOOL` role message.

OpenClaw Gateway provides an OpenAI-compatible `/v1/chat/completions` endpoint that handles tool routing on the gateway side.

### 2.1 The Two Modes of Execution

We will support two execution modes, configurable via `OpenClawConfig`:

1.  **Gateway-Native Execution (Standard):**
    *   Fletcher passes the `tools` definition to the OpenClaw Gateway.
    *   The OpenClaw Gateway handles the execution of the tool (Skills).
    *   The result is returned to Fletcher as part of the stream or as a new turn.
    *   *Benefit:* Lowest latency, leverages existing OpenClaw permissions/sandboxing.

2.  **Fletcher-Mediated Execution (Advanced):**
    *   OpenClaw Gateway suggests a tool call.
    *   Fletcher's `OpenClawLLM` returns the tool call to the LiveKit `VoiceAssistant`.
    *   LiveKit executes a *local* tool (defined in the Python/Node agent script).
    *   *Benefit:* Allows the agent to control local hardware or room state via LiveKit APIs.

---

## 3. Tool Discovery and Execution

### 3.1 Tool Discovery (`src/client.ts`)
The `OpenClawClient` will be updated to fetch available tools from the OpenClaw Gateway.

```typescript
// Proposed addition to OpenClawClient
async getAvailableTools(): Promise<OpenClawTool[]> {
  const response = await fetch(`${this.baseUrl}/v1/tools`, { ... });
  return response.json();
}
```

### 3.2 Exposing Tools to LiveKit (`src/llm.ts`)
The `OpenClawLLM` will dynamically register tools in its `ChatContext`.

*   **Initialization:** When the bridge starts, it queries the Gateway for "Safe-for-Voice" tools.
*   **Transformation:** OpenClaw tool definitions (JSON Schema) are mapped to LiveKit `Tool` objects.
*   **Prompting:** These tools are passed in the `tools` array to the underlying `/v1/chat/completions` call.

---

## 4. Latency Considerations & Audio Pipeline

The <1.5s latency target is critical. Tool calls inherently add latency.

### 4.1 Strategies for Speed
1.  **Pre-computation/Speculative Execution:** If the tool is read-only (e.g., `get_weather`), the Gateway may begin execution as soon as the tool name is parsed from the stream.
2.  **Streaming Tool Results:** OpenClaw supports streaming tool outputs. The bridge will pipe these results back into the LLM context immediately.
3.  **Audio "Wait" Indicators:** While a tool is running (if >500ms), the bridge can signal the `VoiceAssistant` to play a subtle "thinking" sound or use the `AmberOrb` visual heartbeat to indicate activity.

### 4.2 Handling Interruption
If a user interrupts while a tool is executing:
*   The `OpenClawChatStream` must immediately send an Abort signal to the Gateway.
*   The `OpenClawClient` will use `AbortController` to terminate the pending HTTP request.

---

## 5. Security and Permissions

Voice interfaces are vulnerable to accidental tool triggers.

1.  **Voice-Safe Allowlist:** Only tools explicitly marked as `voice_enabled: true` in OpenClaw's `tools.json` or `SKILL.md` will be exposed to the LiveKit agent.
2.  **Confirmation Loop:** For "Destructive" tools (e.g., `delete_file`, `send_email`), the `OpenClawLLM` will force a confirmation turn: "I'm about to send that email, should I proceed?".
3.  **Session Scoping:** Tools will be executed within the context of the current `sessionId`, ensuring that the LLM only accesses data relevant to the current user/session.

---

## 6. Implementation Steps

### Task 6.1: `src/types/index.ts`
*   Add `OpenClawTool` and `OpenClawToolChoice` interfaces.
*   Update `OpenClawChatOptions` to include tool-related fields.

### Task 6.2: `src/client.ts`
*   Implement `listTools()` to query the gateway.
*   Update `chat()` to handle `tool_calls` in the response stream.

### Task 6.3: `src/llm.ts`
*   **Mapping:** Update `OpenClawChatStream.run()` to translate `ChatChunk.delta.toolCalls` into LiveKit's internal format.
*   **Feedback Loop:** Ensure that when LiveKit provides a `ChatRole.TOOL` message, it is correctly passed back to the OpenClaw Gateway to continue the conversation.

### Task 6.4: Integration Testing
*   Create `src/llm.spec.ts` tests using a mocked OpenClaw Gateway that returns a `tool_call` delta.
*   Verify that the `tool_call_id` is preserved throughout the round-trip.

---

## 7. Next Steps

1.  Review this spec with the core team.
2.  Implement Task 6.1 and 6.2 (Types and Client updates).
3.  Refactor `OpenClawLLM` to support tool-result injection.
