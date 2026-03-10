# Epic 21: Photo Upload & Vision Support

**Status:** 🔄 IN PROGRESS
**Goal:** Enable users to upload photos via the Fletcher app and make them available to OpenClaw for vision-based reasoning.

## Summary
To truly become a high-speed instrument, Fletcher needs to support multi-modal input. This epic covers the end-to-end pipeline of capturing/selecting an image in the Flutter app, uploading it to the OpenClaw Gateway, and ensuring the vision-capable model can see and reason about the image in the current session.

## User Stories
- As a user, I want to tap a "Camera" icon to take a photo or select one from my gallery.
- As a user, I want to see a preview of the photo in the chat transcript before/after sending.
- As a user, I want to ask Glitch questions about the photo I just sent.
- As a user, I want the photo to be processed as part of my current conversation context.

## Requirements
- **Flutter App:** Implement image selection/capture and preview UI.
- **Data Transport:** Use the LiveKit Data Channel or a direct Gateway upload endpoint.
- **Gateway Integration:** Store ephemeral image data and associate it with the session key.
- **Model Support:** Ensure the vision part of the model (e.g., Gemini-3) is triggered correctly by the Gateway when images are present.

## Tasks
- [ ] 001: Image Selection & Capture UI (Flutter)
- [ ] 002: Direct Image Upload API in Gateway Integration
- [ ] 003: Inline Image Previews in TUI Transcript
- [ ] 004: Multi-Modal Session Context Support (Gateway-side)
- [ ] 005: Voice-to-Vision Orchestration (Triggering "Look at this")
