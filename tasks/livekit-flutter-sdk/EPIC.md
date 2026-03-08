# Epic: LiveKit Flutter SDK Issues

Tracking bugs and limitations in the upstream `livekit_client` Flutter/Dart SDK that affect Fletcher's mobile client.

These are issues whose root cause lies in the SDK itself (not Fletcher application code), though Fletcher may implement workarounds.

## Open Tasks

- [ ] 004: Fix `addTransceiver: track is null` During Reconnect — null track reference during `rePublishAllTracks` after rapid reconnect cycles ([BUG-025](../../docs/field-tests/20260303-buglog.md))

## Related Closed Tasks (in other epics)

These were resolved with workarounds in their original epics:

- [x] 09-connectivity/007: WiFi → 5G ICE Renegotiation — SDK creates new participants instead of ICE restart (workaround: `departure_timeout: 120s`)
- [x] 09-connectivity/009: Bluetooth Audio Route Recovery — SDK doesn't detect Android audio device changes (workaround: `restartTrack()`)
- [x] 09-connectivity/011: Network Transition Audio Track Timeout — 55s track publish delay from new participant creation + Tailscale tunnel re-establishment
