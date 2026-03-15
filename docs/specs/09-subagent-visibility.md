# EPIC: Real-time Sub-agent Visibility in Fletcher

**Status:** Draft
**Created:** 2026-03-14
**Updated:** 2026-03-14
**Type:** Feature EPIC + Technical Specification
**Scope:** WHY + HOW (Problem, Stories, Requirements, Architecture)

---

## Problem Statement

### Current State
Fletcher users interact with an AI system that spawns sub-agents to handle specialized tasks (research, coding, patent analysis, etc.). These sub-agents work in the background, but users have no visibility into:
- Which sub-agents are currently active
- What each sub-agent is working on
- The status/progress of sub-agent tasks
- When sub-agents complete or fail

This creates a "black box" experience where users send requests and wait, with no insight into what's happening behind the scenes.

### The Pain
**For Users:**
- **Uncertainty:** "Did my request get picked up? Is anything happening?"
- **Context Loss:** "What was that sub-agent working on again?"
- **Trust Issues:** "Is the system stuck, or just thinking?"
- **Missed Opportunities:** Users can't intervene, reprioritize, or cancel sub-agent work

**For Andre (Primary User):**
- **No Oversight:** Can't monitor Static, Needle, or other sub-agents from Fletcher UI
- **Memory Gaps:** Sub-agents complete work while Andre is away; hard to reconstruct what happened
- **Debugging Blindness:** When something goes wrong, no visibility into which sub-agent failed or why

### Why Now?
- Fletcher is becoming the primary interface for OpenClaw interactions
- Sub-agent usage is increasing (Static for specs, Needle for patents, Claude Code for implementation)
- The "Background-First Delegation" pattern (from SOUL.md) is now standard operating procedure
- Field testing has revealed the need for visibility during long-running tasks

---

## User Stories

### Primary Stories

**US-1: See Active Sub-agents**  
As a Fletcher user,  
I want to see a list of currently active sub-agents,  
So that I know what background work is happening.

**US-2: Monitor Sub-agent Progress**  
As a Fletcher user,  
I want to see what each sub-agent is currently working on,  
So that I can understand system activity and estimate completion time.

**US-3: Review Sub-agent History**  
As a Fletcher user,  
I want to see recently completed sub-agent tasks,  
So that I can understand what work was done while I was away.

**US-4: Sub-agent Status Awareness**  
As a Fletcher user,  
I want to know if a sub-agent has failed or is stuck,  
So that I can intervene or retry the task.

### Secondary Stories

**US-5: Contextual Sub-agent Details**  
As a Fletcher user,  
I want to drill into a specific sub-agent to see its full context and output,  
So that I can understand the details of what it's doing.

**US-6: Sub-agent Notifications**  
As a Fletcher user,  
I want to be notified when a sub-agent completes or fails,  
So that I can review results without constantly checking.

**US-7: Quick Glance Awareness**  
As a Fletcher user,  
I want ambient awareness of sub-agent activity (e.g., a badge count),  
So that I know something is happening without needing to open a detailed view.

---

## High-level Requirements

### Functional Requirements

**FR-1: Sub-agent Registry**  
The system must maintain a real-time registry of all active sub-agents, including:
- Agent ID (e.g., `pm-agent`, `patent-researcher`, `claude-code`)
- Human-readable name (e.g., "Static", "Needle", "Claude Code")
- Spawn timestamp
- Current status (active, completed, failed, idle)
- Task description or goal

**FR-2: Progress/Status Updates**  
The system must capture and display sub-agent status updates:
- Current activity description (e.g., "Researching ARM vs ESP32 power consumption")
- Progress indicators (if applicable)
- Last activity timestamp

**FR-3: Historical View**  
The system must retain recently completed/failed sub-agent sessions:
- Last 24 hours minimum
- Final status (completed/failed)
- Summary of work done
- Link to full output/logs

**FR-4: Real-time Updates**  
The UI must reflect sub-agent changes in near-real-time:
- New sub-agents appear when spawned
- Status updates appear as they happen
- Completed sub-agents move to history

**FR-5: Contextual Access**  
Users must be able to access:
- Full conversation/output of a sub-agent session
- Input prompt or task description
- Any errors or warnings

### Non-Functional Requirements

**NFR-1: Performance**  
- Sub-agent status queries should not block the main session
- UI updates should be lightweight (no full page reloads)

**NFR-2: Usability**  
- Sub-agent visibility should be accessible but not intrusive
- Default state: collapsed or minimal (show count/indicator)
- Expanded state: detailed view on demand

**NFR-3: Privacy**  
- Sub-agent details should respect the same privacy boundaries as main sessions
- Sensitive data should not be exposed in status summaries

---

## Success Criteria

### Minimum Viable (MVP)
- [ ] Users can see a list of currently active sub-agents
- [ ] Each sub-agent shows: name, status, and task description
- [ ] Users can view recently completed sub-agents (last session minimum)
- [ ] UI updates when sub-agents are spawned or complete

### Full Success
- [ ] Real-time status updates appear as sub-agents work
- [ ] Users can drill into full sub-agent context/output
- [ ] Ambient awareness (badge count or indicator) shows activity at a glance
- [ ] Failed sub-agents are clearly marked with error details
- [ ] Notifications alert users when sub-agents complete

### Excellence
- [ ] Users can cancel or pause sub-agent tasks
- [ ] Sub-agent priority can be adjusted
- [ ] Historical view includes search and filtering
- [ ] Mobile-friendly responsive design

---

---

# Technical Specification (The HOW)

## Architecture Overview

The Relay server owns sub-agent visibility. It polls for sub-agent status on a background loop, maintains an in-memory registry of known agents, and forwards state changes to the client as system messages over the existing `ganglia-events` data channel.

```
                                  ┌─────────────────────┐
                                  │  Provider Backend    │
                                  │  (OpenClaw Gateway)  │
                                  └──────────┬──────────┘
                                             │
                                   GET /v1/agents/status
                                     (poll every N sec)
                                             │
┌──────────────┐    ganglia-events    ┌──────┴──────────┐
│ Fletcher     │◄─────────────────────│  Relay Server   │
│ Mobile Client│  subagent_status msg │                 │
└──────────────┘                      │  ┌────────────┐ │
                                      │  │ AgentPoll  │ │
                                      │  │ Loop       │ │
                                      │  └─────┬──────┘ │
                                      │        │        │
                                      │  ┌─────▼──────┐ │
                                      │  │ Connector  │ │
                                      │  │ Interface  │ │
                                      │  └────────────┘ │
                                      └─────────────────┘
```

**Key principle:** The Relay is the only component that polls. The client never calls the provider directly for sub-agent data. This keeps the mobile client thin, avoids CORS/auth complexity on the client side, and lets the Relay deduplicate and diff state before forwarding.

---

## Data Structures

### SubagentStatus

The canonical representation of a single sub-agent's state at a point in time. This is the structure the Relay maintains in memory and sends to the client.

```typescript
type SubagentState = 'spawning' | 'active' | 'idle' | 'completed' | 'failed';

interface SubagentStatus {
  /** Stable identifier. e.g. "pm-agent", "claude-code-abc123" */
  agentId: string;

  /** Human-readable display name. e.g. "Static", "Needle" */
  displayName: string;

  /** Current lifecycle state */
  state: SubagentState;

  /** What the agent is doing right now. Null when idle/completed. */
  activity: string | null;

  /** One-line description of the goal/task assigned to this agent */
  taskDescription: string;

  /** ISO-8601 timestamp when the agent was first seen */
  spawnedAt: string;

  /** ISO-8601 timestamp of the most recent state change */
  lastUpdatedAt: string;

  /** Present only when state is 'failed' */
  error?: {
    code: string;
    message: string;
  };

  /** Present only when state is 'completed' */
  summary?: string;
}
```

### SubagentRegistry

The Relay's in-memory store. Not persisted across Relay restarts — the next poll cycle rebuilds it.

```typescript
interface SubagentRegistry {
  /** Map of agentId → current status */
  agents: Map<string, SubagentStatus>;

  /** Completed/failed agents, most-recent-first. Capped at 50 entries. */
  history: SubagentStatus[];

  /** ISO-8601 timestamp of last successful poll */
  lastPollAt: string | null;
}
```

### SubagentStatusEvent (client-facing)

The system message payload sent over `ganglia-events` when state changes.

```typescript
interface SubagentStatusEvent {
  type: 'subagent_status';

  /** 'snapshot' = full registry state; 'delta' = only what changed */
  kind: 'snapshot' | 'delta';

  /** Current active agents (all for snapshot, only changed for delta) */
  agents: SubagentStatus[];

  /** Recently completed/failed (included in snapshot only) */
  history?: SubagentStatus[];

  /** Server timestamp */
  timestamp: string;
}
```

---

## Connector Interface

The connector is the abstraction boundary between the Relay's polling loop and a specific provider backend. Each provider implements this interface. The Relay doesn't know or care whether it's talking to OpenClaw, a mock server, or a future provider.

```typescript
interface SubagentConnector {
  /** Unique identifier for this connector (e.g. "openclaw", "mock") */
  readonly providerId: string;

  /**
   * Fetch the current set of sub-agents and their statuses.
   * Returns all known agents — the poll loop handles diffing.
   * Throws on transient errors (poll loop will retry next cycle).
   */
  poll(): Promise<SubagentStatus[]>;

  /**
   * Optional. Request cancellation of a sub-agent task.
   * Returns true if the provider accepted the cancel request.
   * Not all providers support this — default implementation returns false.
   */
  cancel?(agentId: string): Promise<boolean>;

  /**
   * Called once when the connector is registered. Use for auth handshakes,
   * health checks, or connection pooling setup.
   */
  initialize?(): Promise<void>;

  /**
   * Called on Relay shutdown. Clean up connections, timers, etc.
   */
  dispose?(): Promise<void>;
}
```

### OpenClaw Connector (Reference Implementation)

```typescript
class OpenClawSubagentConnector implements SubagentConnector {
  readonly providerId = 'openclaw';

  private baseUrl: string;
  private apiKey: string | undefined;
  private sessionKey: string;

  constructor(config: OpenClawConfig, sessionKey: string) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.sessionKey = sessionKey;
  }

  async poll(): Promise<SubagentStatus[]> {
    const res = await fetch(`${this.baseUrl}/v1/agents/status`, {
      headers: {
        ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` }),
        'x-openclaw-session-key': this.sessionKey,
      },
    });

    if (!res.ok) {
      throw new Error(`Agent status poll failed: ${res.status}`);
    }

    const data: { agents: SubagentStatus[] } = await res.json();
    return data.agents;
  }

  async cancel(agentId: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/v1/agents/${agentId}/cancel`, {
      method: 'POST',
      headers: {
        ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` }),
        'x-openclaw-session-key': this.sessionKey,
      },
    });
    return res.ok;
  }
}
```

### Provider Contract

The connector expects the provider to expose:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/agents/status` | GET | Returns `{ agents: SubagentStatus[] }` for the session |
| `/v1/agents/:agentId/cancel` | POST | Optional. Requests cancellation of a running agent |

The `x-openclaw-session-key` header scopes the response to the current user's session, consistent with existing OpenClaw routing conventions.

---

## Polling Logic

### AgentPollLoop

The poll loop runs inside the Relay as a background task, decoupled from the main request/response cycle. It does not block voice or chat traffic.

```typescript
class AgentPollLoop {
  private registry: SubagentRegistry;
  private connector: SubagentConnector;
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private onEvent: (event: SubagentStatusEvent) => void;

  constructor(opts: {
    connector: SubagentConnector;
    intervalMs?: number;
    onEvent: (event: SubagentStatusEvent) => void;
  }) {
    this.connector = opts.connector;
    this.intervalMs = opts.intervalMs ?? 10_000; // default: 10s
    this.registry = { agents: new Map(), history: [], lastPollAt: null };
    this.onEvent = opts.onEvent;
  }

  async start(): Promise<void> {
    await this.connector.initialize?.();

    // Immediate first poll — send snapshot
    await this.tick(true);

    this.timer = setInterval(() => this.tick(false), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.connector.dispose?.();
  }

  private async tick(forceSnapshot: boolean): Promise<void> {
    let polled: SubagentStatus[];
    try {
      polled = await this.connector.poll();
    } catch {
      // Swallow transient errors — next tick will retry.
      // Could emit a diagnostic event after N consecutive failures.
      return;
    }

    this.registry.lastPollAt = new Date().toISOString();
    const changes = this.diff(polled);

    if (forceSnapshot || changes.length > 0) {
      this.applyChanges(polled);
      this.onEvent(forceSnapshot
        ? this.buildSnapshot()
        : this.buildDelta(changes));
    }
  }

  private diff(polled: SubagentStatus[]): SubagentStatus[] {
    const changed: SubagentStatus[] = [];
    const polledMap = new Map(polled.map(a => [a.agentId, a]));

    // Detect new, updated, or removed agents
    for (const agent of polled) {
      const existing = this.registry.agents.get(agent.agentId);
      if (!existing || existing.state !== agent.state
          || existing.activity !== agent.activity) {
        changed.push(agent);
      }
    }

    // Detect agents that disappeared (completed/removed server-side)
    for (const [id, existing] of this.registry.agents) {
      if (!polledMap.has(id) && existing.state === 'active') {
        changed.push({ ...existing, state: 'completed',
          lastUpdatedAt: new Date().toISOString() });
      }
    }

    return changed;
  }

  private applyChanges(polled: SubagentStatus[]): void {
    const nextActive = new Map<string, SubagentStatus>();
    for (const agent of polled) {
      if (agent.state === 'completed' || agent.state === 'failed') {
        this.registry.history.unshift(agent);
      } else {
        nextActive.set(agent.agentId, agent);
      }
    }

    // Move disappeared agents to history
    for (const [id, existing] of this.registry.agents) {
      if (!nextActive.has(id) && existing.state !== 'completed'
          && existing.state !== 'failed') {
        this.registry.history.unshift({
          ...existing, state: 'completed',
          lastUpdatedAt: new Date().toISOString(),
        });
      }
    }

    this.registry.agents = nextActive;

    // Cap history
    if (this.registry.history.length > 50) {
      this.registry.history.length = 50;
    }
  }

  private buildSnapshot(): SubagentStatusEvent {
    return {
      type: 'subagent_status',
      kind: 'snapshot',
      agents: [...this.registry.agents.values()],
      history: this.registry.history,
      timestamp: new Date().toISOString(),
    };
  }

  private buildDelta(changes: SubagentStatus[]): SubagentStatusEvent {
    return {
      type: 'subagent_status',
      kind: 'delta',
      agents: changes,
      timestamp: new Date().toISOString(),
    };
  }
}
```

### Poll Interval Strategy

| Client Presence State | Poll Interval | Rationale |
|----------------------|---------------|-----------|
| `ACTIVE` (foreground) | 10 seconds | Near-real-time feel without hammering the backend |
| `BACKGROUND` (< 5 min) | 30 seconds | Conserve resources; client isn't looking |
| `SOFT_DISCONNECT` (> 5 min) | Paused | No point polling; send snapshot on reconnect |
| `DISCONNECTED` | Stopped | Clean up the poll loop entirely |

The poll loop integrates with the existing presence state machine: when the Relay receives a `presence` event from the client, it adjusts the interval or pauses/resumes the loop.

### Adaptive Backoff

When consecutive polls return zero changes, the interval doubles (up to 60s). Any change resets it to the base interval. This reduces idle load while staying responsive when agents are active.

---

## Client Delivery

### Transport

Sub-agent status events are sent over the existing `ganglia-events` LiveKit data channel as a new event type: `subagent_status`. This reuses the established reliable-delivery data channel and requires no new transport infrastructure.

```typescript
// In the Relay's event emitter (existing pattern)
room.localParticipant.publishData(
  JSON.stringify(event),  // SubagentStatusEvent
  { topic: 'ganglia-events', reliable: true }
);
```

### Message Flow

```
1. Poll loop fires tick()
2. Connector.poll() → provider returns SubagentStatus[]
3. diff() detects changes
4. If changes: build delta event, call onEvent()
5. onEvent() publishes to ganglia-events
6. Client receives SubagentStatusEvent
7. Client updates local UI state
```

### Reconnection Handling

When a client reconnects after a `SOFT_DISCONNECT`, the poll loop resumes and immediately sends a `snapshot` event so the client has full state without needing to request it.

---

## Integration with Relay Lifecycle

### Initialization

```typescript
// In Relay session setup (after voice agent join)
const connector = new OpenClawSubagentConnector(openclawConfig, sessionKey);

const pollLoop = new AgentPollLoop({
  connector,
  intervalMs: 10_000,
  onEvent: (event) => {
    room.localParticipant.publishData(
      JSON.stringify(event),
      { topic: 'ganglia-events', reliable: true }
    );
  },
});

await pollLoop.start();
```

### Teardown

```typescript
// In Relay session cleanup
pollLoop.stop();
```

### Presence Integration

```typescript
// In presence event handler (existing code)
function onPresenceEvent(event: PresenceEvent) {
  switch (event.event) {
    case 'foreground':
      pollLoop.setInterval(10_000);
      pollLoop.resume();
      break;
    case 'background':
      pollLoop.setInterval(30_000);
      break;
    case 'disconnect':
      pollLoop.stop();
      break;
  }
}
```

---

## Extending with New Connectors

To add a new provider, implement `SubagentConnector` and register it at session init:

```typescript
// Example: a connector for a hypothetical Linear-based task tracker
class LinearSubagentConnector implements SubagentConnector {
  readonly providerId = 'linear';

  async poll(): Promise<SubagentStatus[]> {
    // Query Linear API for active issues tagged as sub-agent tasks
    // Map Linear issue state → SubagentStatus
  }
}
```

The poll loop doesn't change. The only decision point is which connector to instantiate, driven by configuration:

```typescript
function createConnector(config: RelayConfig): SubagentConnector {
  switch (config.subagentProvider) {
    case 'openclaw':
      return new OpenClawSubagentConnector(config.openclaw, config.sessionKey);
    case 'linear':
      return new LinearSubagentConnector(config.linear);
    default:
      throw new Error(`Unknown subagent provider: ${config.subagentProvider}`);
  }
}
```

---

## Open Design Decisions

| Decision | Options | Recommendation |
|----------|---------|----------------|
| **Snapshot vs. delta-only** | Always send full state vs. diffs | Start with delta + snapshot-on-reconnect. Simpler client logic. |
| **History cap** | Time-based (24h) vs. count-based (50) | Count-based is simpler; 50 entries covers a full day of typical usage. |
| **Poll vs. push** | Polling (this spec) vs. server-sent events from provider | Polling first (simpler, works with any HTTP backend). Add SSE/WebSocket push as an optimization later if needed. |
| **Multi-connector** | One connector per session vs. fan-out to multiple providers | Single connector for MVP. Multi-connector (fan-out + merge) is a future extension. |

---

## Dependencies

- OpenClaw Gateway must expose `GET /v1/agents/status` (scoped by session key)
- OpenClaw Gateway should expose `POST /v1/agents/:agentId/cancel` (optional, for US-4)
- Fletcher mobile client must handle `subagent_status` events on `ganglia-events`
- Relay presence state machine must be wired to poll loop interval control

---

## Open Questions

1. **Granularity:** How detailed should real-time status updates be? (e.g., "Spawned" → "Reading files" → "Generating spec" → "Completed")
2. **Retention:** How long should historical sub-agent data be retained in Fletcher? (Spec proposes 50-entry cap.)
3. **Scope:** Should this include all OpenClaw sessions, or only sub-agents spawned from Fletcher?
4. **User Control:** Should users be able to cancel or pause sub-agents from Fletcher, or is this read-only? (Spec includes optional `cancel` in the connector interface.)

---

## Next Steps

1. **Validate with Andre:** Confirm problem statement, user stories, and technical approach
2. **OpenClaw Gateway:** Spec out `GET /v1/agents/status` endpoint contract
3. **Relay Implementation:** Build `SubagentConnector`, `AgentPollLoop`, and wire into session lifecycle
4. **Client Implementation:** Handle `subagent_status` events in Flutter and render UI
5. **Field Test:** Deploy with mock connector first, validate round-trip before connecting to live OpenClaw

---

## Notes

- This EPIC emerged from the "Background-First Delegation" pattern in SOUL.md
- Related to the "10-Second Tripwire" strategy for offloading deep work
- Should complement, not replace, the existing session/chat interface
- Consider mobile experience (Andre uses Fletcher on phone via voice)
