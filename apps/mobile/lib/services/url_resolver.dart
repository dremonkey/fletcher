import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';

class ResolvedUrl {
  final String url;
  final String? warning;

  const ResolvedUrl({required this.url, this.warning});
}

/// Resolve the correct LiveKit URL for connecting to the server.
///
/// Strategy: when both LAN and Tailscale URLs are configured, race them —
/// attempt a TCP connect to both in parallel and use whichever succeeds first.
/// This handles all cases without platform-specific VPN detection:
///   - On LAN with Tailscale active → both succeed, LAN usually wins (lower latency)
///   - On LAN without Tailscale → only LAN succeeds
///   - On cellular with Tailscale → only Tailscale succeeds
///   - Neither reachable → timeout after [raceTimeout], fall back to LAN URL
///
/// See task 018 for background on why NetworkInterface-based detection is broken
/// on Android 11+.
Future<ResolvedUrl> resolveLivekitUrl({
  required String lanUrl,
  String? tailscaleUrl,
  Duration raceTimeout = const Duration(seconds: 3),
}) async {
  if (tailscaleUrl == null || tailscaleUrl.isEmpty) {
    debugPrint('[UrlResolver] No Tailscale URL configured, using LAN: $lanUrl');
    return ResolvedUrl(url: lanUrl);
  }

  debugPrint('[UrlResolver] Racing LAN ($lanUrl) vs Tailscale ($tailscaleUrl)');

  final winner = await _raceUrls(lanUrl, tailscaleUrl, timeout: raceTimeout);

  if (winner == null) {
    debugPrint('[UrlResolver] Both URLs unreachable — defaulting to LAN: $lanUrl');
    return ResolvedUrl(
      url: lanUrl,
      warning: 'Neither LAN nor Tailscale URL responded within ${raceTimeout.inSeconds}s',
    );
  }

  final label = winner == lanUrl ? 'LAN' : 'Tailscale';
  debugPrint('[UrlResolver] Winner: $label ($winner)');
  return ResolvedUrl(url: winner);
}

/// Race two WebSocket URLs by attempting a TCP connection to each.
/// Returns the URL that connects first, or null if both fail/timeout.
Future<String?> _raceUrls(
  String url1,
  String url2, {
  required Duration timeout,
}) async {
  final completer = Completer<String?>();
  Socket? sock1;
  Socket? sock2;

  Future<void> tryConnect(String wsUrl) async {
    final uri = Uri.parse(wsUrl);
    final host = uri.host;
    final port = uri.port != 0 ? uri.port : (uri.scheme == 'wss' ? 443 : 80);

    try {
      final socket = await Socket.connect(host, port, timeout: timeout);
      // Store for cleanup
      if (wsUrl == url1) {
        sock1 = socket;
      } else {
        sock2 = socket;
      }
      if (!completer.isCompleted) {
        completer.complete(wsUrl);
      }
    } catch (_) {
      // This URL failed — if the other also failed, complete with null
    }
  }

  final f1 = tryConnect(url1);
  final f2 = tryConnect(url2);

  // Wait for either to succeed, or both to fail, or timeout
  await Future.any([
    completer.future,
    Future.wait([f1, f2]),
    Future.delayed(timeout),
  ]);

  // Clean up sockets
  sock1?.destroy();
  sock2?.destroy();

  if (!completer.isCompleted) {
    completer.complete(null);
  }
  return completer.future;
}
