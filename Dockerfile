# Stage 1: Dependencies
FROM node:22-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY .npmrc ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile || pnpm install

# Stage 2: Builder
FROM node:22-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# ensure pnpm settings available during build
COPY .npmrc ./
RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm turbo build

# Stage 3: Runner
FROM node:22-slim AS runner

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app
COPY turbo.json ./

# Copy package files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY .npmrc ./
COPY packages ./packages
COPY apps ./apps
# Install ALL deps (including dev, so turbo exists)
RUN pnpm install --frozen-lockfile || pnpm install

# Install production deps in runner (needed for worker runtime deps)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY .npmrc ./

COPY packages/worker/package.json ./packages/worker/
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ffmpeg && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate && pnpm install --prod --frozen-lockfile || pnpm install --prod



RUN addgroup --system --gid 1001 aistudio && \
    adduser --system --uid 1001 aistudio

# Copy Next.js build output
COPY --from=builder --chown=aistudio:aistudio /app/apps/web/.next ./apps/web/.next
COPY --from=builder --chown=aistudio:aistudio /app/apps/web/public ./apps/web/public


# Copy worker build and all workspace package builds required at runtime
COPY --from=builder --chown=aistudio:aistudio /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=aistudio:aistudio /app/packages/engine/dist ./packages/engine/dist
COPY --from=builder --chown=aistudio:aistudio /app/packages/db/dist ./packages/db/dist
COPY --from=builder --chown=aistudio:aistudio /app/packages/db/package.json ./packages/db/
COPY --from=builder --chown=aistudio:aistudio /app/packages/db/src/migrations ./packages/db/dist/migrations
COPY --from=builder --chown=aistudio:aistudio /app/packages/worker/dist ./packages/worker/dist
COPY --from=builder --chown=aistudio:aistudio /app/packages/worker/package.json ./packages/worker/


# Copy entrypoint
COPY --chown=aistudio:aistudio entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Create data directory
RUN mkdir -p /data && chown aistudio:aistudio /data

USER aistudio

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATA_DIR=/data

EXPOSE 3000

CMD ["./entrypoint.sh"]
