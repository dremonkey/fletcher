import 'dart:io';
import 'package:flutter/foundation.dart';

class ResolvedUrl {
  final String url;
  final String? warning;

  const ResolvedUrl({required this.url, this.warning});
}

/// Check if any network interface has an address in the Tailscale CGNAT range
/// (100.64.0.0/10). Detection is by IP range rather than interface name since
/// tun0 naming isn't guaranteed across Android OEM skins.
Future<bool> hasTailscaleInterface() async {
  try {
    final interfaces = await NetworkInterface.list();
    for (final iface in interfaces) {
      for (final addr in iface.addresses) {
        if (addr.type != InternetAddressType.IPv4) continue;
        final parts = addr.address.split('.');
        if (parts.length != 4) continue;
        final first = int.tryParse(parts[0]);
        final second = int.tryParse(parts[1]);
        if (first == null || second == null) continue;
        // 100.64.0.0/10 = first octet 100, second octet 64-127
        if (first == 100 && second >= 64 && second <= 127) {
          return true;
        }
      }
    }
  } catch (e) {
    debugPrint('[UrlResolver] Failed to list interfaces: $e');
  }
  return false;
}

/// Resolve the correct LiveKit URL based on the device's network state.
///
/// - Tailscale active + tailscaleUrl available → use tailscaleUrl
/// - Tailscale active + tailscaleUrl null → use lanUrl with warning
/// - No Tailscale → use lanUrl
Future<ResolvedUrl> resolveLivekitUrl({
  required String lanUrl,
  String? tailscaleUrl,
}) async {
  final hasTailscale = await hasTailscaleInterface();

  if (hasTailscale) {
    if (tailscaleUrl != null && tailscaleUrl.isNotEmpty) {
      debugPrint('[UrlResolver] Tailscale detected, using: $tailscaleUrl');
      return ResolvedUrl(url: tailscaleUrl);
    }
    debugPrint('[UrlResolver] Tailscale detected but no server URL configured');
    return ResolvedUrl(
      url: lanUrl,
      warning:
          'Tailscale VPN active but no server URL configured. '
          'Disable Tailscale on phone or redeploy with Tailscale on dev machine.',
    );
  }

  debugPrint('[UrlResolver] No Tailscale interface, using LAN: $lanUrl');
  return ResolvedUrl(url: lanUrl);
}
