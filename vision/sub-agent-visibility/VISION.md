# Sub-Agent Visibility -- Product Vision

## The Problem

When a Fletcher user asks the AI to perform a complex task -- "fix the login bug," "refactor the auth module," "research pricing strategies" -- the request dispatches to one or more sub-agents (Claude Code, OpenClaw) that work behind the scenes. Today, the user sees **nothing**. The voice agent might say "I'm working on it," but there is zero transparency into:

- **What** sub-agents are running
- **What** each agent is currently doing (reading files, executing commands, thinking)
- **Whether** an agent is stuck, errored, or making progress
- **How long** it has been working
- **What** it produced when finished

This is the "loading spinner problem" at AI-agent scale. The user is left staring at the orb, unsure if the system is broken or busy, with no recourse but to wait and hope.

## Who This Is For

**Primary ICP: Developer-operators of Fletcher.** These are technically fluent users who run their own Fletcher instance, often at a desk or on the go, issuing voice commands that trigger complex multi-step agent work. They are comfortable with system diagnostics, terminal output, and developer tooling.

They care about:
- Knowing the system is alive and making progress
- Being able to diagnose stuck or failed agents without SSH-ing into the server
- Understanding what was done, not just what was said
- Having confidence to walk away and check back, knowing they will see what happened

**Secondary ICP: Power users consuming Fletcher as a product.** Non-operators who still want to see that "things are happening" -- the AI equivalent of watching a build log scroll by. They do not need to understand every detail, but they need the assurance that work is underway.

## Value Proposition

**Real-time transparency into AI agent work, delivered passively through the existing Fletcher UI.**

Sub-agent visibility turns a black box into a glass box. The user sees a compact indicator when agents are running, can tap to expand a detailed view, and gets clear signals when work completes or fails -- all without leaving the conversation screen.

This is not a dashboard. It is ambient awareness. The information is there when you glance at it, gone when you do not need it.

## Design Principles

1. **Ambient, not intrusive.** Sub-agent status should be as noticeable as a system tray icon: visible at a glance, ignorable by default. No modals, no alerts, no interruptions to conversation flow.

2. **Full snapshots, not diffs.** The wire protocol sends complete state on every update. This eliminates synchronization bugs, simplifies the client, and makes late-joining or reconnecting trivial. With 0-5 agents at <500 bytes each, bandwidth is negligible.

3. **Read-only observation.** Users see what agents are doing; they cannot control them. No start/stop/cancel buttons. This keeps the scope tight and avoids building a task management system.

4. **Fits existing infrastructure.** Sub-agent data flows through the same LiveKit data channel the app already uses for status events, artifacts, and transcripts. No new transport, no new connection, no new auth. The relay already has provider patterns and data channel pub/sub. The Flutter app already has a DiagnosticsBar with a trailing widget slot.

5. **Progressive disclosure.** Chip shows count and aggregate status. Tap reveals per-agent detail. Each level adds information without requiring the previous one.

## What Success Looks Like

| Signal | Metric |
|--------|--------|
| Users can tell agents are running | Sub-agent chip appears within 2s of agent start |
| Users can see what agents are doing | Last activity text updates at least every 5s during active work |
| Users know when agents finish | Status transitions to `completed` / `errored` within 2s of actual completion |
| Information is not stale | Snapshot interval <= 3s for active agents |
| Feature does not degrade UX | No additional latency to voice pipeline; data channel overhead < 1KB/s |
| Developer can debug agent issues from phone | Task name, model, duration, and last output visible in panel without server access |

## What This Is Not

- **Not a task queue manager.** Users cannot create, cancel, or reprioritize agent work.
- **Not a log viewer.** The panel shows summary state, not streaming stdout.
- **Not a notification system.** No push notifications, no badges, no sounds when agents complete.
- **Not multi-user.** This shows agents associated with the current session, not a global view.

## Risks and Open Questions

| Risk | Mitigation |
|------|------------|
| Claude Code JSONL format changes without notice | Provider uses defensive parsing; unknown fields ignored; schema versioned |
| OpenClaw does not emit granular enough events | Passive provider degrades gracefully to "running" / "completed" status only |
| Too many agents make the panel unwieldy | Cap display at 10 agents; oldest completed agents roll off first |
| Snapshot frequency creates data channel congestion | Full snapshots are tiny (<2.5KB for 5 agents); sent on a separate topic; debounced to max 1/s |

## Delivery Scope

Epic 28 delivers:

1. **Server-side provider framework** (relay) -- pluggable `SubAgentProvider` interface, registry, two concrete providers (Claude Code filesystem watcher, OpenClaw passive event capture)
2. **Wire protocol** -- `sub_agent_snapshot` messages on the `"sub-agents"` data channel topic
3. **Client-side service** (Flutter) -- `SubAgentService` that parses snapshots and exposes state via `ChangeNotifier`
4. **Client-side UI** (Flutter) -- `SubAgentChip` in DiagnosticsBar trailing slot, `SubAgentPanel` bottom sheet with per-agent cards
5. **Architecture documentation** -- updates to data-channel-protocol.md, mobile-client.md, system-overview.md
