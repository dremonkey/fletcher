import 'dart:convert';
import 'dart:typed_data';

/// JSON-RPC 2.0 codec for the Fletcher Relay data channel protocol.
///
/// Message flow (data channel, topic "relay"):
///
///   Mobile                     Relay                    ACP (OpenClaw)
///     │                          │                          │
///     ├─ JsonRpcRequest ────────►│─── forward ─────────────►│
///     │  session/prompt          │   (injects sessionId)    │
///     │                          │                          │
///     │◄─ JsonRpcNotification ──│◄── session/update ───────│
///     │   session/update         │   (content_chunk)        │
///     │                          │                          │
///     │◄─ JsonRpcResponse ──────│◄── result ───────────────│
///     │   {stopReason}           │                          │

const _jsonRpcVersion = '2.0';

// ---------------------------------------------------------------------------
// Outbound: mobile → relay
// ---------------------------------------------------------------------------

/// A JSON-RPC 2.0 request (expects a response with matching `id`).
class JsonRpcRequest {
  final int id;
  final String method;
  final Map<String, dynamic>? params;

  const JsonRpcRequest({required this.id, required this.method, this.params});

  Map<String, dynamic> toJson() => {
        'jsonrpc': _jsonRpcVersion,
        'id': id,
        'method': method,
        if (params != null) 'params': params,
      };

  Uint8List encode() => Uint8List.fromList(utf8.encode(jsonEncode(toJson())));
}

/// A JSON-RPC 2.0 notification (no response expected).
class JsonRpcNotification {
  final String method;
  final Map<String, dynamic>? params;

  const JsonRpcNotification({required this.method, this.params});

  Map<String, dynamic> toJson() => {
        'jsonrpc': _jsonRpcVersion,
        'method': method,
        if (params != null) 'params': params,
      };

  Uint8List encode() => Uint8List.fromList(utf8.encode(jsonEncode(toJson())));
}

// ---------------------------------------------------------------------------
// Inbound: relay → mobile
// ---------------------------------------------------------------------------

/// Structured JSON-RPC 2.0 error object.
class JsonRpcError {
  final int code;
  final String message;
  final dynamic data;

  const JsonRpcError({required this.code, required this.message, this.data});

  factory JsonRpcError.fromJson(Map<String, dynamic> json) => JsonRpcError(
        code: json['code'] as int,
        message: json['message'] as String,
        data: json['data'],
      );

  @override
  String toString() => 'JsonRpcError($code: $message)';
}

/// A decoded inbound JSON-RPC 2.0 message — either a response or notification.
sealed class JsonRpcMessage {}

/// Response to a request (matched by `id`).
class JsonRpcResponse extends JsonRpcMessage {
  final int id;
  final dynamic result;
  final JsonRpcError? error;

  JsonRpcResponse({required this.id, this.result, this.error});

  bool get isError => error != null;
}

/// Server-initiated notification (no `id`).
class JsonRpcServerNotification extends JsonRpcMessage {
  final String method;
  final Map<String, dynamic> params;

  JsonRpcServerNotification({required this.method, required this.params});
}

/// Decode a raw data channel payload into a typed [JsonRpcMessage].
///
/// Returns `null` if the payload is not valid JSON-RPC 2.0.
JsonRpcMessage? decodeJsonRpc(Uint8List data) {
  try {
    final json = jsonDecode(utf8.decode(data)) as Map<String, dynamic>;
    if (json['jsonrpc'] != '2.0') return null;

    // Response: has `id` + (`result` or `error`)
    if (json.containsKey('id') &&
        (json.containsKey('result') || json.containsKey('error'))) {
      return JsonRpcResponse(
        id: json['id'] as int,
        result: json['result'],
        error: json.containsKey('error')
            ? JsonRpcError.fromJson(json['error'] as Map<String, dynamic>)
            : null,
      );
    }

    // Notification: has `method`, no `id`
    if (json.containsKey('method') && !json.containsKey('id')) {
      return JsonRpcServerNotification(
        method: json['method'] as String,
        params: (json['params'] as Map<String, dynamic>?) ?? {},
      );
    }

    return null;
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ID generator
// ---------------------------------------------------------------------------

/// Auto-incrementing request ID generator.
class JsonRpcIdGenerator {
  int _next = 1;
  int next() => _next++;
}
