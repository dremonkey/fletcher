import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { TokenVerifier } from 'livekit-server-sdk';
import { createFetchHandler, wsUrlToHttp, type TokenServerConfig } from './token-server';

const TEST_API_KEY = 'test-api-key';
const TEST_API_SECRET = 'test-secret-that-is-long-enough-for-jose';
const TEST_LIVEKIT_URL = 'ws://localhost:7880';
const DEFAULT_AGENT_NAME = 'fletcher-voice';

function makeConfig(overrides: Partial<TokenServerConfig> = {}): TokenServerConfig {
  return {
    livekitUrl: TEST_LIVEKIT_URL,
    apiKey: TEST_API_KEY,
    apiSecret: TEST_API_SECRET,
    agentName: DEFAULT_AGENT_NAME,
    ...overrides,
  };
}

/** Helper to build a GET Request object for testing. */
function makeRequest(path: string): Request {
  return new Request(`http://localhost${path}`);
}

/** Helper to build a POST Request with JSON body. */
function makePostRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('token-server', () => {
  describe('GET /health', () => {
    it('returns ok: true', async () => {
      const handler = createFetchHandler(makeConfig());
      const res = await handler(makeRequest('/health'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
    });
  });

  describe('GET /token', () => {
    it('returns a valid token and url', async () => {
      const handler = createFetchHandler(makeConfig());
      const res = await handler(makeRequest('/token?room=test-room&identity=user-1'));
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.url).toBe(TEST_LIVEKIT_URL);
      expect(typeof body.token).toBe('string');
      expect(body.token.length).toBeGreaterThan(0);
    });

    it('returns 400 when room param is missing', async () => {
      const handler = createFetchHandler(makeConfig());
      const res = await handler(makeRequest('/token?identity=user-1'));
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toContain('Missing');
    });

    it('returns 400 when identity param is missing', async () => {
      const handler = createFetchHandler(makeConfig());
      const res = await handler(makeRequest('/token?room=test-room'));
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toContain('Missing');
    });

    it('returns 400 when both params are missing', async () => {
      const handler = createFetchHandler(makeConfig());
      const res = await handler(makeRequest('/token'));
      expect(res.status).toBe(400);
    });

    it('does not include room config with agent dispatch (on-demand only)', async () => {
      const handler = createFetchHandler(makeConfig());
      const res = await handler(makeRequest('/token?room=test-room&identity=user-1'));
      const body = await res.json();

      const verifier = new TokenVerifier(TEST_API_KEY, TEST_API_SECRET);
      const claims = await verifier.verify(body.token);

      // Agent dispatch removed from JWT — agents join via POST /dispatch-agent
      expect(claims.roomConfig?.agents ?? []).toHaveLength(0);
    });

    it('includes correct video grants', async () => {
      const handler = createFetchHandler(makeConfig());
      const res = await handler(makeRequest('/token?room=test-room&identity=user-1'));
      const body = await res.json();

      const verifier = new TokenVerifier(TEST_API_KEY, TEST_API_SECRET);
      const claims = await verifier.verify(body.token);

      expect(claims.video?.room).toBe('test-room');
      expect(claims.video?.roomJoin).toBe(true);
      expect(claims.video?.roomCreate).toBe(true);
      expect(claims.video?.canPublish).toBe(true);
      expect(claims.video?.canSubscribe).toBe(true);
      expect(claims.video?.canPublishData).toBe(true);
    });
  });

  describe('unknown routes', () => {
    it('returns 404 for unknown paths', async () => {
      const handler = createFetchHandler(makeConfig());
      const res = await handler(makeRequest('/unknown'));
      expect(res.status).toBe(404);
    });
  });

  describe('wsUrlToHttp', () => {
    it('converts ws:// to http://', () => {
      expect(wsUrlToHttp('ws://localhost:7880')).toBe('http://localhost:7880');
    });

    it('converts wss:// to https://', () => {
      expect(wsUrlToHttp('wss://my-project.livekit.cloud')).toBe('https://my-project.livekit.cloud');
    });

    it('leaves http:// unchanged', () => {
      expect(wsUrlToHttp('http://localhost:7880')).toBe('http://localhost:7880');
    });

    it('leaves https:// unchanged', () => {
      expect(wsUrlToHttp('https://example.com')).toBe('https://example.com');
    });
  });

  describe('POST /dispatch-agent', () => {
    it('returns 400 when room_name is missing', async () => {
      const handler = createFetchHandler(makeConfig());
      const res = await handler(makePostRequest('/dispatch-agent', {}));
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.status).toBe('error');
      expect(body.message).toContain('room_name');
    });

    it('returns 400 when room_name is not a string', async () => {
      const handler = createFetchHandler(makeConfig());
      const res = await handler(makePostRequest('/dispatch-agent', { room_name: 123 }));
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.status).toBe('error');
      expect(body.message).toContain('room_name');
    });

    it('returns 400 when room_name is an empty string', async () => {
      const handler = createFetchHandler(makeConfig());
      const res = await handler(makePostRequest('/dispatch-agent', { room_name: '' }));
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.status).toBe('error');
    });

    it('returns 500 when dispatch fails (no LiveKit server)', async () => {
      const handler = createFetchHandler(makeConfig());
      const res = await handler(makePostRequest('/dispatch-agent', { room_name: 'test-room' }));
      // Without a real LiveKit server, the dispatch call will fail
      expect(res.status).toBe(500);

      const body = await res.json();
      expect(body.status).toBe('error');
      expect(typeof body.message).toBe('string');
    });

    it('rejects GET requests to /dispatch-agent with 404', async () => {
      const handler = createFetchHandler(makeConfig());
      const res = await handler(makeRequest('/dispatch-agent'));
      expect(res.status).toBe(404);
    });
  });

});
