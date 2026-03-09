import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';

class TokenResult {
  final String token;
  final String url;

  const TokenResult({required this.token, required this.url});
}

/// Fetches LiveKit access tokens from the token endpoint.
///
/// Races all candidate hosts in parallel — whichever responds first wins.
/// This mirrors the URL resolver strategy so the token fetch works in all
/// topologies (LAN, Tailscale, emulator 10.0.2.2).
Future<TokenResult> fetchToken({
  required List<String> hosts,
  required int port,
  required String roomName,
  required String identity,
}) async {
  if (hosts.isEmpty) {
    throw Exception('No token server hosts configured');
  }

  debugPrint('[TokenService] Racing ${hosts.length} hosts for token: ${hosts.join(", ")}');

  final completer = Completer<TokenResult>();
  final errors = <String>[];

  for (final host in hosts) {
    _tryFetchToken(host: host, port: port, roomName: roomName, identity: identity)
        .then((result) {
      if (!completer.isCompleted) {
        completer.complete(result);
      }
    }).catchError((e) {
      errors.add('$host: $e');
      // If all hosts failed, complete with error
      if (errors.length == hosts.length && !completer.isCompleted) {
        completer.completeError(
          Exception('All token hosts failed:\n${errors.join("\n")}'),
        );
      }
    });
  }

  return completer.future;
}

Future<TokenResult> _tryFetchToken({
  required String host,
  required int port,
  required String roomName,
  required String identity,
}) async {
  final uri = Uri.http('$host:$port', '/token', {
    'room': roomName,
    'identity': identity,
  });

  debugPrint('[TokenService] Trying $uri');

  final client = HttpClient();
  client.connectionTimeout = const Duration(seconds: 5);

  try {
    final request = await client.getUrl(uri);
    final response = await request.close();
    final body = await response.transform(utf8.decoder).join();

    if (response.statusCode != 200) {
      throw Exception('Token endpoint returned ${response.statusCode}: $body');
    }

    final json = jsonDecode(body) as Map<String, dynamic>;
    final token = json['token'] as String?;
    final url = json['url'] as String?;

    if (token == null || url == null) {
      throw Exception('Token endpoint returned incomplete response: $body');
    }

    debugPrint('[TokenService] Token acquired from $host for room=$roomName');
    return TokenResult(token: token, url: url);
  } finally {
    client.close();
  }
}
