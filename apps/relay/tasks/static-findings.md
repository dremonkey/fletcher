# Static's Findings — Fletcher Relay Planning (2026-03-10)

**Subagent:** Static (pm-agent)  
**Task:** Epic 22 Relay planning and spec gap analysis  
**Status:** ✅ COMPLETE

---

## Executive Summary

The **Fletcher Relay architecture is excellent** — the dual-mode strategy, cost economics, and LiveKit non-agent participant approach are all sound. However, the **implementation specs have a mismatch**: the relay epic tasks (001-010) still reference the outdated WebSocket + Claude Agent SDK approach, while the architecture has pivoted to LiveKit data channel + OpenClaw Gateway.

**Bottom line:** The relay is **not yet implementation-ready**. A coding agent would get blocked asking ~50 clarifying questions about integration details.

**What I delivered:**
1. **Comprehensive Execution Plan** (`relay-execution-plan.md`) — 19 tasks across 5 phases
2. **Critical Gaps Summary** (`blocking-gaps.md`) — 6 missing specs that block implementation
3. **This summary** (for Andre)

---

## Key Findings

### ✅ What's Well-Defined

- High-level architecture (LiveKit participant + OpenClaw proxy)
- Economic justification (60x cost savings for text vs. voice)
- Network resilience rationale (ICE restart handles WiFi ↔ 5G switches)
- JSON-RPC 2.0 protocol (industry standard, well-documented)
- Relay lifecycle (join on demand, idle timeout after 5 min)

### 🚨 What's Missing (6 Critical Gaps)

1. **OpenClaw Gateway API Contract** — Exact HTTP endpoints, session key handling, SSE stream format
2. **Data Channel Protocol** — Topic name, message envelope format, routing logic
3. **Token Server Signal API** — HTTP endpoint for "join room X" signal from token server → relay
4. **Room Coordination Metadata** — Schema for agent/relay mutual exclusion (who's handling messages)
5. **Session Persistence Schema** — SQLite table structure for session state across restarts
6. **Error Recovery Strategies** — Retry policies, timeout handling, failure mode responses

**Why these matter:** Without these specs, a coding agent will make arbitrary decisions (e.g., "retry OpenClaw 3 times with exponential backoff") that may not match the intended UX. Filling these gaps up front means zero architectural questions during implementation.

---

## Execution Plan Overview

**Phase 1: Foundation & Transport** (Tasks R-001 to R-005)  
Get the relay running as a LiveKit participant with basic JSON-RPC echo.

**Phase 2: OpenClaw Integration** (Tasks R-006 to R-010)  
Wire relay ↔ OpenClaw Gateway, handle session lifecycle, stream responses.

**Phase 3: Lifecycle & Health** (Tasks R-011 to R-014)  
Idle timeout, token server signal, health endpoints, error recovery. **Relay is MVP-complete here.**

**Phase 4: Ganglia Compatibility** (Tasks R-015 to R-016) — _Optional_  
Allow voice sessions to route through relay too (unified backend switching).

**Phase 5: Advanced Features** (Tasks R-017 to R-019) — _Post-MVP_  
Artifacts, background task push, backend abstraction (Claude SDK support).

**Recommended implementation order:**
1. Build Phase 1 (basic transport)
2. **Resolve the 6 gaps** (research + documentation)
3. Build Phase 2 (OpenClaw integration)
4. Resolve remaining gaps (data channel, token server, room coordination)
5. Build Phase 3 (relay is now MVP-complete)
6. Flutter integration (Epic 22 tasks 042-051) can proceed in parallel

---

## Decision Point for Andre

**Option A: Static proceeds to fill the gaps**  
I (Static) can:
- Read OpenClaw Gateway source/docs and draft the API contract (Gap 1)
- Review Flutter data channel code and propose protocol (Gap 2)
- Draft token server signal API spec (Gap 3)
- Draft room coordination state machine (Gap 4)
- Draft SQLite persistence schema (Gap 5)
- Draft error handling policies (Gap 6)

**Estimated time:** 2-4 hours of research + documentation.

**Then:** I create the 14 detailed task specs (R-001 to R-014) so a coding agent can implement the relay with zero architectural input.

**Option B: Glitch handles some/all gaps**  
If you prefer to own certain decisions (e.g., error handling policies, room coordination logic), I can draft the "non-opinionated" gaps (API contracts, schemas) and leave the policy decisions for you.

**Option C: Defer relay implementation**  
Put Epic 22 on hold and focus on other priorities. The relay can wait until there's clearer need for chat mode.

---

## What This Unlocks

Once the relay is implemented (Phases 1-3 complete):

✅ **Epic 22 tasks 042-051 can proceed** — Flutter app can integrate chat mode  
✅ **Text interactions cost 60x less** than routing through voice agent  
✅ **Network handoffs are seamless** — ICE restart handles WiFi ↔ 5G  
✅ **Voice mode stays unchanged** — agent continues to handle STT/TTS/VAD  
✅ **Conversation context is continuous** — same OpenClaw session key across modes  

---

## Files Delivered

1. **`apps/relay/tasks/relay-execution-plan.md`**  
   Comprehensive 19-task execution plan with phase breakdown, success criteria, and anti-goals.

2. **`apps/relay/tasks/blocking-gaps.md`**  
   Detailed analysis of the 6 critical gaps, why they block implementation, and how to resolve each one.

3. **`apps/relay/tasks/static-findings.md`** (this file)  
   Summary for Andre with decision point.

---

## Recommendation

**Proceed with Option A** (Static fills gaps, then creates task specs). The gaps are all **research and documentation** — no code changes, no irreversible decisions. Once documented, they can be reviewed and adjusted before implementation starts.

**Why this approach:**
- Unblocks a coding agent to implement the relay immediately after review
- Keeps Static in the "specs and research" lane (no code)
- Allows Andre/Glitch to review and course-correct before any implementation happens
- Fastest path to a working relay (gaps + tasks + implementation = ~1-2 days total)

**Next step if approved:** Static proceeds to draft the 6 gap docs in `apps/relay/docs/`, then creates the 14 task specs in `apps/relay/tasks/relay-mvp/`.

---

**End of Static's Findings**

Standing by for Andre's decision. 📋⚡
