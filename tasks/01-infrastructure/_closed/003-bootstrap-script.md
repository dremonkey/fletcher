# Task: Cross-Platform Bootstrap Script

**Status:** Complete
**Owner:** Subagent
**Date:** 2026-02-18

## Context
We need to ensure development environment parity between the NixOS workstation and the MacBook Pro, especially for the upcoming Houston trip. A unified bootstrap script will reduce friction when switching contexts or setting up new machines.

## Requirements

The script `scripts/bootstrap.sh` must be idempotent and handle the following:

### 1. OS Detection
- Detect if running on **NixOS** (Linux) or **macOS** (Darwin).
- Exit with a helpful error if an unsupported OS is detected.

### 2. System Dependencies
- **Common:** Verify `nix` is installed and experimental features (`flakes`, `nix-command`) are enabled.
- **NixOS:** Verify `nix-ld` is configured (required for prebuilt binaries like Bun/Android tools).
- **macOS:** Verify `Xcode` command line tools are installed.

### 3. Nix Environment
- Automate entering the Nix environment.
- *Note:* Since the script itself likely runs *outside* the environment initially, it should perhaps wrap execution or instruct the user to run `nix develop` if dependencies are missing. Alternatively, it can be the entry point that shells out to `nix develop --command ...`.

### 4. Android Setup
- Accept Android SDK licenses automatically (using `yes` or `sdkmanager --licenses`).
- Check if an AVD (Android Virtual Device) exists. If not, prompt the user to create one or provide instructions (automating AVD creation can be brittle, but checking for existence is good).

### 5. JS/Monorepo Setup
- Run `bun install` to set up node modules.

### 6. iOS Setup (macOS only)
- Enter the `ios` directory and run `pod install` (or `npx pod-install`).

## Success Criteria
- [ ] Script runs on NixOS without errors.
- [ ] Script runs on macOS without errors.
- [ ] Re-running the script does not break existing state (idempotency).
