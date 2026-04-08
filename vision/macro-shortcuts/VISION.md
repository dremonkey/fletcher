# Macro Shortcuts — Vision

## Vision Statement

Give mobile developers a physical control surface for their AI agent — nine programmable buttons that collapse multi-step voice or text workflows into a single thumb tap.

## ICP: Who Is This For?

**Primary:** Developers who use Fletcher as their daily AI voice assistant on a mobile device. They are power users who have already adopted voice-first interaction but hit friction on repetitive, predictable commands. They are comfortable with terse interfaces. They value speed over discoverability.

**Persona:** A developer walking between meetings, phone in one hand, who needs to fire off "run the test suite," "commit what I have," or "show me the bug log" without stopping to dictate or type. They have 3-8 commands they use daily and dozens they use weekly. The cost of reaching for voice every time is not latency — it is cognitive overhead and social friction (speaking commands aloud in public).

**Not for (yet):** Non-developer end users. The macro system is developer-facing infrastructure. It becomes a user-facing feature only after the command ecosystem matures beyond dev workflows.

## Problem Statement

Fletcher's voice interface is high-friction for the exact commands developers use most often. The paradox: the more you use an AI assistant, the more your interactions become predictable and repetitive. Voice excels at novel, complex requests. It is overkill for "run tests" for the fifteenth time today.

Today, a developer who wants to trigger a known command has three options, all bad:
1. **Voice:** Say the command aloud. Works, but slow (~2s round trip), awkward in public, and forces you to remember exact phrasing.
2. **Text input:** Tap the mic to enter text mode, type `/memory search project goals`, hit enter. Four actions minimum.
3. **Don't bother:** Skip the interaction entirely. This is what actually happens — useful commands go unused because the activation cost exceeds the perceived benefit.

The macro grid turns a 4-step, 5-second interaction into a 1-step, 200ms interaction. That 25x reduction in interaction cost is the difference between a command being used and being ignored.

## Value Proposition

**Why macros?** Because predictable interactions deserve predictable UI. A 3x3 grid of thumb-reachable buttons is the most information-dense, lowest-latency input mechanism available on a touchscreen. Nine slots is enough to cover a developer's daily command vocabulary without overwhelming the screen.

**Why now?** Three prerequisites are in place:
1. **Command infrastructure exists.** The `CommandRegistry` handles local slash commands. The relay routes `session/prompt` to ACP. The plumbing for "tap button, execute command" is already built.
2. **ACP discovery is live.** OpenClaw emits `available_commands_update` on session init. The mobile app already receives it (as `AcpNonContentUpdate`) — it just doesn't parse or surface the data yet. The dynamic command pool is a wire away.
3. **Text mode is shipping.** Epic 17 (Text Input) and Epic 22 (Dual-Mode) established that Fletcher is not voice-only. Macros are the logical next step: if you can type a command, you should be able to tap one.

**Why not a command palette / search?** A searchable command list (Spotlight-style) is the right answer for 50+ commands. But Fletcher's mobile context demands a different interaction model. You cannot comfortably search a command palette one-handed while walking. The macro grid is optimized for the physical reality of mobile use: large touch targets, no keyboard, one thumb. The picker UI serves the configuration step (which commands go where), not the execution step.

## Positioning: Where This Fits in Fletcher's Product Story

Fletcher is an open-source mobile ACP client. Its input modalities are:
1. **Voice** — talk to your agent (shipped)
2. **Text** — type to your agent when voice is impractical (shipped)
3. **Macros** — tap to trigger known commands instantly (this)
4. **Automation** — commands that fire without any human input (future)

Macros fill the gap between "I know what I want to say" and "I don't want to say it." They are the third input modality, and the fastest one. They also serve as the foundation for automation — a macro that can be tapped can eventually be scheduled, chained, or triggered by events.

Because Fletcher is backend-agnostic (any ACP agent plugs in via `ACP_COMMAND`), macros auto-populate from whatever commands the connected agent exposes via ACP's `available_commands_update`. The macro grid adapts to the agent, not the other way around.

From the user's perspective, the macro grid is Fletcher's "toolbar." It is the first piece of persistent, always-visible UI beyond the mic button. It signals that Fletcher is not just a chatbot — it is a workstation.

## Success Metrics

**Leading indicators (ship week):**
- Macro grid renders without obstructing chat transcript or voice controls
- A developer can bind a command to a slot and execute it in under 3 seconds (first time) / under 500ms (subsequent taps)
- At least 6 of 9 slots are filled with meaningful commands from the default set

**Lagging indicators (4 weeks post-ship):**
- Macro taps per session > 0 for active users (adoption signal — are people actually using them?)
- Reduction in average text-input command length (macros replacing typed slash commands)
- At least 2 users have customized their grid (the defaults are not sufficient)
- No regression in voice interaction rate (macros complement voice, not replace it)

**Anti-metrics (watch for but do not optimize):**
- Macro taps should not replace voice for novel/complex requests. If macro usage correlates with decreased voice usage for non-repetitive tasks, the feature is cannibalizing Fletcher's core value.

## Launch Narrative

**Internal (to the team):**
"We're adding a 3x3 quick-action grid to Fletcher. It's the fastest way to trigger commands you already know — one tap instead of speaking or typing. Think of it as programmable function keys for your phone. It's developer-facing first, ships with a curated default set, and self-populates with whatever commands the agent exposes."

**External (to users, when ready):**
"Fletcher now has macro shortcuts — nine customizable buttons in your thumb zone that fire any command instantly. Long-press to remap. The grid auto-discovers new commands from your agent. Voice for thinking, macros for doing."

## Open Questions and Challenges

1. **Screen real estate tension.** The macro grid competes with the chat transcript for vertical space. The current layout is tight: DiagnosticsBar (48dp) + chat + VoiceControlBar (56dp+). A 3x3 grid at minimum 48dp per button is 144dp — nearly a third of a small phone screen. The grid may need to be collapsible, or overlay the transcript as a floating panel rather than consuming layout space.

2. **Command argument handling.** Some commands take arguments (e.g., `/memory search <query>`). A macro can hardcode the argument ("always search for 'project goals'"), prompt the user for input on tap, or send the command without arguments and let the agent ask. Each approach has different UX tradeoffs. The task files punt on this — it needs a decision.

3. **Persistence model.** Where do macro bindings live? `SharedPreferences` is the obvious choice (consistent with TTS toggle, session storage). But if Fletcher gains multi-device support (Sovereign Pairing, Epic 7), bindings should sync. For now, local-only is fine, but the model should be designed for future portability.

4. **Default set curation.** The task says "developer-first" but does not specify the 9 default macros. This matters — defaults are the feature for 80% of users. A bad default set means the grid ships empty-feeling. Needs deliberate curation based on actual OpenClaw command usage data.
