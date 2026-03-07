# TASK-017: Visual-Audio Artifact Coordination

## Status
- **Status:** Not started
- **Priority:** High

## Context
Complex data should be seen, not just heard. We need to implement the pattern where high-density information is pushed to a UI artifact while the voice provides the narrative summary.

## Requirements
- Configure the agent to automatically push a Markdown Artifact for any list longer than 3 items or technical data blocks.
- Implement "Verbal Anchoring" phrases (e.g., "I've pushed the full breakdown to your screen...") to guide the user's attention.
- Ensure the verbal summary focuses on "Headlines and Feelings" while the artifact handles "Nitty-Gritty and Structure".

## Acceptance Criteria
- Detailed lists trigger an automatic artifact creation.
- The verbal response remains under 3-4 sentences even when delivering complex data.
- Clear verbal references connect the speech to the visual data.
