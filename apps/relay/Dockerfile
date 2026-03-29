FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS install
COPY package.json bun.lock ./
COPY patches/ patches/
COPY packages/acp-client/package.json packages/acp-client/
COPY packages/livekit-agent-ganglia/package.json packages/livekit-agent-ganglia/
COPY packages/tui/package.json packages/tui/
COPY apps/relay/package.json apps/relay/
COPY apps/voice-agent/package.json apps/voice-agent/
RUN bun install --frozen-lockfile

# Build: copy source for relay and its workspace dependency (acp-client)
FROM install AS build
COPY tsconfig.base.json ./
COPY packages/acp-client/ packages/acp-client/
COPY apps/relay/ apps/relay/

# Runtime
FROM base
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/acp-client packages/acp-client
COPY --from=build /app/apps/relay apps/relay
COPY --from=build /app/package.json .
COPY --from=build /app/tsconfig.base.json .

ENTRYPOINT ["bun", "run", "apps/relay/src/index.ts"]
