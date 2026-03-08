# TASK-023: Background Auto-Close Timer Regression

## Status
- **Status:** Open
- **Priority:** Medium
- **Owner:** Unassigned
- **Created:** 2026-03-07

## Bug Reference
- [BUG-028](../../docs/field-tests/20260307-buglog.md) — Background auto-close timer does not start when switching to another app
- Related: [Task 019](../_closed/019-background-session-timeout.md) (original implementation, closed)

## Problem

The background session timeout (implemented in Task 019) is not firing when the user switches to another app. The timer should start a 10-minute countdown when the app goes to background and disconnect the voice session when it expires. Instead, the session stays alive indefinitely in the background.

This is a regression — Task 019 was marked complete but the timer doesn't activate in the current build.

## Investigation

1. Check if the `WidgetsBindingObserver.didChangeAppLifecycleState` callback fires on app backgrounding
2. Check if the method channel for screen lock detection is wired correctly
3. Verify `stopWithTask="true"` is set in the foreground service
4. Test on the current build to confirm the regression

## Acceptance Criteria
- [ ] Background timer starts when app goes to background
- [ ] Session disconnects after 10 minutes in background
- [ ] Notification countdown is visible during the timer period
- [ ] Timer cancels if app returns to foreground
