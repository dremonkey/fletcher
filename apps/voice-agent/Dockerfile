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

# Build ganglia (needed for workspace resolution)
FROM install AS build
COPY tsconfig.base.json ./
COPY packages/livekit-agent-ganglia/ packages/livekit-agent-ganglia/
COPY apps/voice-agent/ apps/voice-agent/
COPY scripts/ scripts/
RUN cd packages/livekit-agent-ganglia && bun run build

# Download turn detector model files from HuggingFace
RUN bun run apps/voice-agent/src/agent.ts download-files

# Runtime
FROM base
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages packages
COPY --from=build /app/apps/voice-agent apps/voice-agent
COPY --from=build /app/scripts scripts
COPY --from=build /app/package.json .
COPY --from=build /app/tsconfig.base.json .
COPY --from=build /root/.cache/huggingface /root/.cache/huggingface

ENTRYPOINT ["bun", "run", "apps/voice-agent/src/agent.ts"]
CMD ["dev"]
