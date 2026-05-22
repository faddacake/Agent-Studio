FROM node:20

WORKDIR /app

# Copy package files (explicit paths required — globs flatten into dest dir, losing subdirectory structure)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/adapters/package.json packages/adapters/package.json
COPY packages/crypto/package.json packages/crypto/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/worker/package.json packages/worker/package.json

# Install dependencies (including dev)
RUN corepack enable && \
    pnpm install --frozen-lockfile

# Copy source
COPY . .

EXPOSE 3000

CMD ["pnpm", "dev"]
