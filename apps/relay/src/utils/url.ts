/**
 * Convert a WebSocket URL to its HTTP equivalent.
 *
 * LiveKit's LIVEKIT_URL is typically ws:// or wss://, but
 * RoomServiceClient expects http:// or https://.
 */
export function wsUrlToHttp(wsUrl: string): string {
  if (wsUrl.startsWith("wss://")) return wsUrl.replace("wss://", "https://");
  if (wsUrl.startsWith("ws://")) return wsUrl.replace("ws://", "http://");
  return wsUrl;
}
