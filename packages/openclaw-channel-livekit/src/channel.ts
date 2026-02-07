/**
 * LiveKit Channel Plugin implementation.
 *
 * Implements the OpenClaw ChannelPlugin interface for voice conversations.
 */
import {
  listLivekitAccountIds,
  resolveLivekitAccount,
  getDefaultLivekitAccountId,
  isLivekitAccountConfigured,
  describeLivekitAccount,
  DEFAULT_ACCOUNT_ID,
} from "./config.js";
import { getLivekitLogger } from "./runtime.js";
import { VoiceAgent } from "./livekit/audio.js";
import { connectToRoom, disconnectRoom, generateAgentToken } from "./livekit/connection.js";
import type { ResolvedLivekitAccount, LivekitChannelConfig } from "./types.js";

/**
 * Active voice agents per account.
 */
const activeAgents = new Map<string, VoiceAgent>();

/**
 * Active room connections per account.
 */
const activeRooms = new Map<string, unknown>();

/**
 * OpenClaw configuration type (minimal).
 */
interface OpenClawConfig {
  channels?: {
    livekit?: LivekitChannelConfig;
  };
}

/**
 * Gateway context for start/stop operations.
 */
interface GatewayContext {
  account: ResolvedLivekitAccount;
  cfg: OpenClawConfig;
  runtime: unknown;
  abortSignal?: AbortSignal;
  log?: {
    info: (msg: string) => void;
    debug: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

/**
 * LiveKit channel plugin.
 */
export const livekitPlugin = {
  id: "livekit" as const,

  meta: {
    label: "LiveKit Voice",
    docsPath: "/docs/channels/livekit",
    icon: "microphone",
  },

  capabilities: {
    chatTypes: ["direct"] as const,
    reactions: false,
    threads: false,
    media: false,
    // Custom capabilities for voice
    audio: true,
    realtime: true,
  },

  reload: {
    configPrefixes: ["channels.livekit"],
  },

  /**
   * Configuration adapter.
   */
  config: {
    listAccountIds: (cfg: OpenClawConfig) => listLivekitAccountIds(cfg),

    resolveAccount: (cfg: OpenClawConfig, accountId?: string) =>
      resolveLivekitAccount({ cfg, accountId }),

    defaultAccountId: (cfg: OpenClawConfig) => getDefaultLivekitAccountId(cfg),

    isConfigured: (account: ResolvedLivekitAccount) => isLivekitAccountConfigured(account),

    describeAccount: (account: ResolvedLivekitAccount) => describeLivekitAccount(account),

    resolveAllowFrom: (params: { cfg: OpenClawConfig; accountId?: string }) => {
      const account = resolveLivekitAccount(params);
      return account.dm.allowFrom;
    },

    formatAllowFrom: (params: { allowFrom: string[] }) =>
      params.allowFrom.map((entry) => entry.trim().toLowerCase()).filter(Boolean),

    setAccountEnabled: (params: {
      cfg: OpenClawConfig;
      accountId: string;
      enabled: boolean;
    }) => {
      // Return updated config (immutable pattern)
      const { cfg, accountId, enabled } = params;
      const accounts = cfg.channels?.livekit?.accounts ?? {};
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          livekit: {
            ...cfg.channels?.livekit,
            accounts: {
              ...accounts,
              [accountId]: {
                ...accounts[accountId],
                enabled,
              },
            },
          },
        },
      };
    },

    deleteAccount: (params: { cfg: OpenClawConfig; accountId: string }) => {
      const { cfg, accountId } = params;
      const accounts = { ...cfg.channels?.livekit?.accounts };
      delete accounts[accountId];
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          livekit: {
            ...cfg.channels?.livekit,
            accounts,
          },
        },
      };
    },
  },

  /**
   * Security adapter for DM policies.
   */
  security: {
    resolveDmPolicy: (params: {
      cfg: OpenClawConfig;
      accountId?: string;
      account: ResolvedLivekitAccount;
    }) => {
      const { account, accountId } = params;
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      return {
        policy: account.dm.policy,
        allowFrom: account.dm.allowFrom,
        allowFromPath: `channels.livekit.accounts.${resolvedAccountId}.dm.`,
        approveHint: 'Use "/pair livekit <participant-id>" to approve',
        normalizeEntry: (raw: string) => raw.trim().toLowerCase(),
      };
    },
  },

  /**
   * Messaging adapter for target resolution.
   */
  messaging: {
    normalizeTarget: (raw: string) => {
      // LiveKit targets are room names
      const trimmed = raw.trim();
      if (!trimmed) return undefined;
      // Remove any protocol prefix
      return trimmed.replace(/^livekit:\/?\/?/, "");
    },

    targetResolver: {
      looksLikeId: (input: string) => {
        // Room names are typically alphanumeric with hyphens/underscores
        return /^[a-zA-Z0-9_-]+$/.test(input.trim());
      },
      hint: "Room name (e.g., 'my-room' or 'meeting-123')",
    },
  },

  /**
   * Gateway adapter for lifecycle management.
   */
  gateway: {
    /**
     * Start the voice agent for an account.
     */
    startAccount: async (ctx: GatewayContext): Promise<void> => {
      const { account, abortSignal } = ctx;
      const log = ctx.log ?? getLivekitLogger();

      log.info(`[${account.accountId}] Starting LiveKit voice agent`);

      if (!isLivekitAccountConfigured(account)) {
        log.warn(`[${account.accountId}] Account not configured, skipping`);
        return;
      }

      try {
        // Generate token for the agent
        const token = await generateAgentToken({
          url: account.url,
          apiKey: account.apiKey,
          apiSecret: account.apiSecret,
          roomName: `${account.roomPrefix}lobby`,
          participantName: "OpenClaw Agent",
          participantIdentity: `agent-${account.accountId}`,
        });

        // Connect to the room
        const room = await connectToRoom({
          url: account.url,
          token,
        });

        activeRooms.set(account.accountId, room);

        // Create and start voice agent
        const roomName = room.name ?? `${account.roomPrefix}lobby`;
        const agent = new VoiceAgent({
          roomId: roomName,
          account,
        });

        await agent.start(room);
        activeAgents.set(account.accountId, agent);

        log.info(`[${account.accountId}] Voice agent started successfully`);

        // Handle abort signal for graceful shutdown
        abortSignal?.addEventListener("abort", () => {
          log.info(`[${account.accountId}] Received abort signal, stopping agent`);
          agent.close().catch((err) => {
            log.error(`[${account.accountId}] Error closing agent: ${err}`);
          });
          disconnectRoom(room);
          activeAgents.delete(account.accountId);
          activeRooms.delete(account.accountId);
        });
      } catch (error) {
        log.error(`[${account.accountId}] Failed to start voice agent: ${error}`);
        throw error;
      }
    },

    /**
     * Stop the voice agent for an account.
     */
    stopAccount: async (ctx: GatewayContext): Promise<void> => {
      const { account } = ctx;
      const log = ctx.log ?? getLivekitLogger();

      log.info(`[${account.accountId}] Stopping LiveKit voice agent`);

      const agent = activeAgents.get(account.accountId);
      if (agent) {
        await agent.close();
        activeAgents.delete(account.accountId);
      }

      const room = activeRooms.get(account.accountId);
      if (room) {
        disconnectRoom(room);
        activeRooms.delete(account.accountId);
      }

      log.info(`[${account.accountId}] Voice agent stopped`);
    },
  },

  /**
   * Outbound adapter for sending responses.
   */
  outbound: {
    deliveryMode: "gateway" as const,

    /**
     * Send a text response (will be synthesized to speech).
     */
    sendText: async (params: {
      to: string;
      text: string;
      accountId?: string;
    }) => {
      const { to, text, accountId = DEFAULT_ACCOUNT_ID } = params;
      const log = getLivekitLogger();

      const agent = activeAgents.get(accountId);
      if (!agent) {
        log.warn(`[${accountId}] No active agent for room ${to}`);
        return { channel: "livekit", success: false, error: "No active agent" };
      }

      try {
        await agent.say(text);
        return { channel: "livekit", success: true };
      } catch (error) {
        log.error(`[${accountId}] Failed to send text: ${error}`);
        return { channel: "livekit", success: false, error: String(error) };
      }
    },
  },

  /**
   * Status adapter for monitoring.
   */
  status: {
    defaultRuntime: {},

    buildChannelSummary: () => ({
      activeAgents: activeAgents.size,
      activeRooms: activeRooms.size,
    }),

    buildAccountSnapshot: (params: { account: ResolvedLivekitAccount }) => ({
      accountId: params.account.accountId,
      enabled: params.account.enabled,
      configured: isLivekitAccountConfigured(params.account),
      hasActiveAgent: activeAgents.has(params.account.accountId),
    }),

    probeAccount: async (params: { account: ResolvedLivekitAccount }) => {
      const { account } = params;
      if (!isLivekitAccountConfigured(account)) {
        return { ok: false, error: "Account not configured" };
      }

      try {
        // Try to generate a token as a health check
        await generateAgentToken({
          url: account.url,
          apiKey: account.apiKey,
          apiSecret: account.apiSecret,
          roomName: "health-check",
          participantName: "probe",
          participantIdentity: "probe",
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    },
  },
};
