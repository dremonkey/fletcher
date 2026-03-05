# 018: Fix URL Resolver VPN Detection on Android 11+

## Problem

The Tailscale URL resolver (`url_resolver.dart`) uses `NetworkInterface.list()` to detect whether Tailscale is active by scanning for CGNAT IPs (`100.64.0.0/10`). This worked during development but **fails on Android 11+** because the OS hides VPN interfaces created by other apps from `getifaddrs()`.

**Result:** The app always connects via the LAN IP, which is unreachable from cellular. Users lose connectivity the moment they leave WiFi range, even though Tailscale is running and the server is reachable via Tailscale.

**Confirmed in field testing (2026-03-04 evening session):**
- `adb shell ip addr show` shows `inet 100.109.35.114/32 scope global tun0` (Tailscale active)
- App's `[UrlResolver]` logs: "No Tailscale interface" — 11 times across all reconnect attempts
- Client stuck on `ws://192.168.87.59:7880` (LAN IP) for 10+ minutes on cellular

## Why ICE Restart Masks the Bug

The morning session (same day) worked on cellular because the app initially connected on WiFi, and the LiveKit SDK's **ICE restart** migrated the WebRTC media path to Tailscale automatically — ICE candidates include the server's Tailscale IP, and the phone can reach it via its own Tailscale tunnel.

But when the connection is **fully lost** (not just an ICE path change), the app must do a fresh WebSocket connect via the URL resolver — and that's where it breaks. The resolver can't detect Tailscale, so every fresh connect attempt goes to the unreachable LAN IP.

**Timeline of a typical failure:**
1. App starts on WiFi → connects via LAN IP (URL resolver: "No Tailscale")
2. WebRTC established → ICE candidates include Tailscale IPs on both sides
3. Phone leaves WiFi → ICE restart migrates media to Tailscale ✓
4. Eventually connection fully drops (too long offline, SDK gives up)
5. App-level reconnect → URL resolver → "No Tailscale" → LAN IP → unreachable ✗
6. User stuck until back on WiFi

## Root Cause

Android 11+ restricts `getifaddrs()` (used by Java's `NetworkInterface.getNetworkInterfaces()` and Dart's `NetworkInterface.list()`) to hide VPN tunnel interfaces (`tun0`) created by other apps. This is a security/privacy restriction — only the VPN app itself can see its own tunnel. Our Flutter app sees wlan, rmnet, and loopback interfaces but never tun0.

## Proposed Solutions

### Option A: Race Both URLs (Recommended)

Try both LAN and Tailscale URLs in parallel. Use whichever connects first.

```dart
Future<ResolvedUrl> resolveLivekitUrl({
  required String lanUrl,
  String? tailscaleUrl,
}) async {
  if (tailscaleUrl == null || tailscaleUrl.isEmpty) {
    return ResolvedUrl(url: lanUrl);
  }

  // Race: try both URLs, use whichever WebSocket connects first
  final winner = await raceUrls(lanUrl, tailscaleUrl, timeout: Duration(seconds: 5));
  return ResolvedUrl(url: winner);
}
```

**Pros:** No platform-specific code. Works regardless of Android version. Self-healing — always finds the best path.
**Cons:** Slightly more complex. Two connection attempts per connect (one will fail/timeout). Need to handle cleanup of the loser.

### Option B: Android Platform Channel (VPN Detection)

Use Android's `ConnectivityManager` to detect active VPN via a platform channel.

```kotlin
// Android native
val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
val activeNetwork = cm.activeNetwork
val caps = cm.getNetworkCapabilities(activeNetwork)
val hasVpn = caps?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true
```

**Pros:** Direct, reliable detection. Minimal overhead.
**Cons:** Platform-specific (Android only). Requires Kotlin/Java platform channel. Doesn't help on iOS.

### Option C: Always Use Tailscale URL When Configured

If `LIVEKIT_URL_TAILSCALE` is set, always use it. Tailscale routes LAN traffic efficiently when both devices are on the same network (direct connection, no relay).

**Pros:** Simplest possible fix. No detection needed.
**Cons:** Adds ~1-5ms latency on LAN (Tailscale overhead). Depends on Tailscale being configured.

## Checklist

- [x] Implement Option C: always use Tailscale URL when configured
- [x] Remove `hasTailscaleInterface()` (broken on Android 11+)
- [x] Update task 008 to note the Android limitation
- [x] Update `docs/architecture/network-connectivity.md`
- [ ] Field test: verify cellular connectivity with Tailscale active
- [ ] Rebuild and deploy Flutter app to device

## Related

- **Task 008:** Original Tailscale URL resolution implementation (code complete, detection broken)
- **BUG-031:** Field test discovery — [20260304-buglog.md](../../docs/field-tests/20260304-buglog.md)
- **BUG-028:** Session instability on cellular (compounded by this bug)

## Status
- **Date:** 2026-03-04
- **Priority:** High — blocks all cellular use
