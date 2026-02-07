# @knittt/livekit-agent-openclaw

## Purpose
This package provides a `livekit-agents` LLM implementation that delegates reasoning to an OpenClaw instance. This allows LiveKit agents to leverage OpenClaw's tool-calling, long-term memory, and multi-agent orchestration.

## Architecture
The plugin implements the `llm.LLM` interface from the LiveKit Agents SDK.

### Key Components
- **OpenClawLLM:** Main class extending `llm.LLM`.
- **OpenClawChat:** Handles stream generation and mapping OpenClaw messages to LiveKit `ChatMessage` objects.
- **OpenClawClient:** Internal utility for communicating with the OpenClaw Gateway API.

## Implementation Details
- **API Endpoint:** Communicates with OpenClaw via the `/v1/chat/completions` (OpenAI compatible) or internal OpenClaw RPC.
- **Tool Mapping:** Maps LiveKit tool definitions to OpenClaw's tool schema.
- **Context Management:** Passes LiveKit conversation history into the OpenClaw context.
