import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';

class ResolvedUrl {
  final String url;
  final String? warning;

  const ResolvedUrl({required this.url, this.warning});
}

/// Resolve the correct LiveKit URL by racing all configured candidates.
///
/// Strategy: attempt a TCP connect to every URL in parallel and use whichever
/// succeeds first. This handles all network topologies without platform-specific
/// VPN detection:
///   - On LAN with Tailscale active → both succeed, LAN usually wins (lower latency)
///   - On LAN without Tailscale → only LAN succeeds
///   - On cellular with Tailscale → only Tailscale succeeds
///   - In Android emulator → 10.0.2.2 succeeds (host alias), LAN also reachable
///   - None reachable → timeout after [raceTimeout], fall back to first URL
///
/// See task 018 for background on why NetworkInterface-based detection is broken
/// on Android 11+.
Future<ResolvedUrl> resolveLivekitUrl({
  required List<String> urls,
  Duration raceTimeout = const Duration(seconds: 3),
}) async {
  // Filter out empty/null entries
  final candidates = urls.where((u) => u.isNotEmpty).toList();

  if (candidates.isEmpty) {
    return const ResolvedUrl(
      url: '',
      warning: 'No LiveKit URLs configured',
    );
  }

  if (candidates.length == 1) {
    debugPrint('[UrlResolver] Single URL configured: ${candidates.first}');
    return ResolvedUrl(url: candidates.first);
  }

  debugPrint('[UrlResolver] Racing ${candidates.length} URLs: ${candidates.join(", ")}');

  final winner = await _raceUrls(candidates, timeout: raceTimeout);

  if (winner == null) {
    debugPrint('[UrlResolver] All URLs unreachable — defaulting to: ${candidates.first}');
    return ResolvedUrl(
      url: candidates.first,
      warning: 'No URL responded within ${raceTimeout.inSeconds}s',
    );
  }

  debugPrint('[UrlResolver] Winner: $winner');
  return ResolvedUrl(url: winner);
}

/// Race N WebSocket URLs by attempting a TCP connection to each.
/// Returns the URL that connects first, or null if all fail/timeout.
Future<String?> _raceUrls(
  List<String> urls, {
  required Duration timeout,
}) async {
  final completer = Completer<String?>();
  final sockets = <Socket>[];

  Future<void> tryConnect(String wsUrl) async {
    final uri = Uri.parse(wsUrl);
    final host = uri.host;
    final port = uri.port != 0 ? uri.port : (uri.scheme == 'wss' ? 443 : 80);

    try {
      final socket = await Socket.connect(host, port, timeout: timeout);
      sockets.add(socket);
      if (!completer.isCompleted) {
        completer.complete(wsUrl);
      }
    } catch (_) {
      // This URL failed — if all others also fail, complete with null
    }
  }

  final futures = urls.map(tryConnect).toList();

  // Wait for any to succeed, or all to fail, or timeout
  await Future.any([
    completer.future,
    Future.wait(futures),
    Future.delayed(timeout),
  ]);

  // Clean up all sockets
  for (final s in sockets) {
    s.destroy();
  }

  if (!completer.isCompleted) {
    completer.complete(null);
  }
  return completer.future;
}
