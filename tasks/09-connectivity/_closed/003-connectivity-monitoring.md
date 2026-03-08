# Task: Add network connectivity monitoring

## Description
The app has no awareness of network state. When offline, reconnect attempts fire blindly and exhaust the retry budget before the network returns. Adding `connectivity_plus` lets us detect online/offline transitions and make smarter reconnection decisions.

## Checklist
- [x] Add `connectivity_plus` to `apps/mobile/pubspec.yaml`
- [x] Create a lightweight `ConnectivityService` (or add to `HealthService`) that exposes a `Stream<bool>` for online/offline state
- [x] Track current connectivity status: `wifi`, `cellular`, `none`
- [x] Expose a synchronous `bool get isOnline` getter for use in reconnect guards
- [x] Update `HealthService` to include network status in diagnostics
- [x] Wire connectivity stream into `LiveKitService` (subscription in `connect()`, cancel in `disconnect()`)
- [x] Verify Android and iOS permissions/setup for `connectivity_plus`

## Context
- `apps/mobile/pubspec.yaml` — add dependency
- `apps/mobile/lib/services/` — new service or extend `health_service.dart`
- `connectivity_plus` provides `Connectivity().onConnectivityChanged` stream and `checkConnectivity()` for current state
- No special permissions needed on Android/iOS for basic connectivity checks

## Why
This is the foundation for network-aware retry (task 004). Without knowing whether the device has a network connection, we can't make intelligent decisions about when to retry.
