# Transports

> Mechanisms for agents and clients to communicate with each other

ACP uses JSON-RPC to encode messages. JSON-RPC messages **MUST** be UTF-8 encoded.

## stdio

The primary transport:

- The client launches the agent as a subprocess
- The agent reads JSON-RPC from stdin and sends to stdout
- Messages are delimited by newlines (`\n`) and **MUST NOT** contain embedded newlines
- stderr **MAY** be used for logging
- stdout **MUST** only contain valid ACP messages

## Streamable HTTP

*In discussion, draft proposal in progress.*

## Custom Transports

Agents and clients **MAY** implement additional custom transport mechanisms. Must preserve JSON-RPC format and ACP lifecycle requirements.

Source: https://agentclientprotocol.com/protocol/transports
