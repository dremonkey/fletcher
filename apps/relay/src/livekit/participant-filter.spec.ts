import { describe, expect, it } from "bun:test";
import {
  isHumanParticipant,
  PARTICIPANT_KIND_AGENT,
  RELAY_IDENTITY_PREFIX,
} from "./participant-filter";

describe("isHumanParticipant", () => {
  it("returns true for a normal user", () => {
    expect(isHumanParticipant({ identity: "user-123", kind: 0 })).toBe(true);
  });

  it("returns false for relay participants", () => {
    expect(isHumanParticipant({ identity: "relay-abc", kind: 0 })).toBe(false);
  });

  it("returns false for agent participants (kind=4)", () => {
    expect(
      isHumanParticipant({ identity: "voice-agent", kind: PARTICIPANT_KIND_AGENT }),
    ).toBe(false);
  });

  it("returns true when identity and kind are undefined", () => {
    expect(isHumanParticipant({})).toBe(true);
  });

  it("exports expected constants", () => {
    expect(PARTICIPANT_KIND_AGENT).toBe(4);
    expect(RELAY_IDENTITY_PREFIX).toBe("relay-");
  });
});
