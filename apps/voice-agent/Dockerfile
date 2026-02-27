FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS install
COPY package.json bun.lock ./
COPY packages/livekit-agent-ganglia/package.json packages/livekit-agent-ganglia/
COPY packages/openclaw-channel-livekit/package.json packages/openclaw-channel-livekit/
COPY packages/tui/package.json packages/tui/
COPY apps/voice-agent/package.json apps/voice-agent/
RUN bun install --frozen-lockfile

# Build ganglia (needed for workspace resolution)
FROM install AS build
COPY tsconfig.base.json ./
COPY packages/livekit-agent-ganglia/ packages/livekit-agent-ganglia/
COPY apps/voice-agent/ apps/voice-agent/
RUN cd packages/livekit-agent-ganglia && bun run build

# Runtime
FROM base
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages packages
COPY --from=build /app/apps/voice-agent apps/voice-agent
COPY --from=build /app/package.json .
COPY --from=build /app/tsconfig.base.json .

CMD ["sh", "-c", "bun run apps/voice-agent/src/agent.ts connect --room ${LIVEKIT_ROOM:-fletcher-dev}"]
