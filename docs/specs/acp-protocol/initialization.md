# Initialization

> Establishing protocol connections

The Initialization phase enables Clients and Agents to establish protocol connections through version negotiation and capability exchange. Before a Session can be created, Clients **MUST** initialize the connection by calling the `initialize` method.

## Protocol Version Negotiation

The protocol uses single integer versions representing major releases only. If an Agent cannot support the Client's requested version, it responds with its own latest supported version. Clients should terminate connections when version compatibility cannot be established.

## Capabilities Framework

Clients and Agents **MUST** treat all capabilities omitted in the `initialize` request as **UNSUPPORTED**.

### Client Capabilities

- `fs.readTextFile` — File system read access
- `fs.writeTextFile` — File system write access
- `terminal` — Terminal access for shell command execution

### Agent Capabilities

- `loadSession` — Session loading support
- `promptCapabilities.text` — Text content in prompts (always true)
- `promptCapabilities.image` — Image content in prompts
- `promptCapabilities.audio` — Audio content in prompts
- `promptCapabilities.embeddedContext` — Embedded resource content in prompts
- `mcpCapabilities.http` — MCP server connections via HTTP
- `mcpCapabilities.sse` — MCP server connections via SSE (deprecated)
- `sessionCapabilities.list` — Session listing support

## Implementation Information

Both parties should provide `name`, `title`, and `version` details, with `title` being the human-readable identifier for UI contexts.

Once the connection is initialized, you're ready to create a session and begin the conversation with the Agent.

Source: https://agentclientprotocol.com/protocol/initialization
