# Agent Client Protocol Overview

The Agent Client Protocol enables bidirectional communication between Agents (AI-powered code modification programs) and Clients (user interfaces like code editors) through JSON-RPC 2.0 messaging.

## Key Communication Patterns

The protocol uses two message types: "Methods" for request-response pairs and "Notifications" for one-way messages. A typical interaction flows through initialization, session setup, and prompt turns where the client sends user messages and the agent provides updates.

## Core Capabilities

**Agent Methods** include baseline operations like `initialize`, `authenticate`, and `session/prompt` for sending user prompts. Optional methods enable session loading and mode switching.

**Client Methods** handle permissions, file system operations (reading/writing text files), and terminal management. Clients use `session/update` notifications to inform agents of changes.

## Technical Requirements

All file paths in the protocol **MUST** be absolute and uses 1-based line numbering. Error handling follows JSON-RPC 2.0 standards with `result` fields for success and `error` objects containing code and message fields.

## Extensibility Features

The protocol supports custom functionality through underscore-prefixed method names, `_meta` fields for custom data, and custom capability advertisement during initialization.

## Protocol Pages

| Page | Description |
|------|-------------|
| [Initialization](./initialization.md) | Version negotiation and capability exchange |
| [Session Setup](./session-setup.md) | Creating and loading sessions |
| [Session List](./session-list.md) | Discovering existing sessions |
| [Prompt Turn](./prompt-turn.md) | Core conversation flow |
| [Content](./content.md) | Content block types (text, image, audio, resource, resource_link) |
| [Tool Calls](./tool-calls.md) | Tool execution and status reporting |
| [File System](./file-system.md) | Client filesystem access methods |
| [Terminals](./terminals.md) | Terminal command execution |
| [Agent Plan](./agent-plan.md) | Execution plan communication |
| [Session Modes](./session-modes.md) | Agent operating modes (deprecated, use config options) |
| [Session Config Options](./session-config-options.md) | Flexible session configuration |
| [Slash Commands](./slash-commands.md) | Available command advertisement |
| [Extensibility](./extensibility.md) | Custom data and capabilities |
| [Transports](./transports.md) | Communication mechanisms (stdio, HTTP) |
| [Schema](./schema.md) | Complete schema definitions |

Source: https://agentclientprotocol.com/protocol/overview
