# Fletcher Confidence Loop: Mobile Dev Process

**Vision:** A repeatable, high-confidence development cycle that allows autonomous agents (Static) to build, test, and verify mobile UI/UX with zero human "eyes-on" requirement during the build.

---

## 1. The Cycle: Red ➔ Green ➔ Proof

### Phase 1: Definition (Spec)
Before code is written, a task is defined in the `tasks/` directory. This task defines the **Expected Behavior** and the **Success Criteria**.

### Phase 2: The Failure (Red)
Static writes an **Integration Test** in `integration_test/app_test.dart` that covers the new behavior.
- **Action:** Run `flutter test integration_test/app_test.dart`.
- **Requirement:** The test MUST fail.

### Phase 3: The Implementation (Fix)
Static modifies the code in `lib/` to satisfy the test.
- **Requirement:** Code must follow the "Warm and Grounded" design standards (no jargon, tactile logic).

### Phase 4: The Verification (Green)
Static runs the test again.
- **Requirement:** The test MUST pass on the running emulator.

### Phase 5: The Proof (Snapshot)
Once the test is green, Static generates evidence for the main session:
1. **Screenshot:** `adb exec-out screencap -p > screenshots/PROOFS/[task-id].png`
2. **UI Dump:** `adb shell uiautomator dump` (to verify the widget tree is programmatically sound).
3. **Commit:** `git commit -m "feat: [task-id] - [description]"`

---

## 2. Testing Standards

- **Visibility:** Every key widget must have a `Key` (e.g., `Key('amber_heartbeat')`) so the integration test can find it reliably.
- **State Transitions:** Tests must simulate external events (like a LiveKit audio signal) and verify the UI state changes (e.g., Heartbeat pulse intensity).
- **Visual Regression:** Proof screenshots are stored in `screenshots/PROOFS/` for human review.

---

## 3. Automation "Hands and Eyes"

- **Eyes:** `adb exec-out screencap` serves as the agent's eyes.
- **Hands:** `flutter_test` and `integration_test` packages serve as the agent's hands.
- **Memory:** `docs/tech-specs/` serves as the project's long-term technical memory.

---

*This process ensures that every row of code is knitted with intention and verified by proof.*
