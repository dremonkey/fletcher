import 'package:flutter/foundation.dart';

class ResolvedUrl {
  final String url;
  final String? warning;

  const ResolvedUrl({required this.url, this.warning});
}

/// Resolve the correct LiveKit URL for connecting to the server.
///
/// Strategy: if a Tailscale URL is configured, always use it. Tailscale
/// handles same-LAN routing efficiently (direct connection, no relay), so
/// there's no meaningful penalty when both devices are on the same network.
/// This avoids the broken `NetworkInterface.list()` detection — Android 11+
/// hides VPN interfaces created by other apps (like Tailscale), so CGNAT
/// scanning never finds tun0. See task 018 for details.
///
/// - tailscaleUrl configured → always use it
/// - tailscaleUrl not configured → use lanUrl
Future<ResolvedUrl> resolveLivekitUrl({
  required String lanUrl,
  String? tailscaleUrl,
}) async {
  if (tailscaleUrl != null && tailscaleUrl.isNotEmpty) {
    debugPrint('[UrlResolver] Using Tailscale URL: $tailscaleUrl');
    return ResolvedUrl(url: tailscaleUrl);
  }

  debugPrint('[UrlResolver] No Tailscale URL configured, using LAN: $lanUrl');
  return ResolvedUrl(url: lanUrl);
}
