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
/// The token endpoint runs alongside the LiveKit server and generates JWTs
/// on demand so the mobile client can create dynamic room names without
/// bundling API secrets on-device.
Future<TokenResult> fetchToken({
  required String host,
  required int port,
  required String roomName,
  required String identity,
}) async {
  final uri = Uri.http('$host:$port', '/token', {
    'room': roomName,
    'identity': identity,
  });

  debugPrint('[TokenService] Fetching token from $uri');

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

    debugPrint('[TokenService] Token acquired for room=$roomName');
    return TokenResult(token: token, url: url);
  } finally {
    client.close();
  }
}
