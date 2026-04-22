#!/bin/bash
set -e

echo "[entrypoint] Starting AI Studio..."

# Ensure data directories exist
mkdir -p /data/db /data/assets /data/config

# Start Next.js server (Process 1) — run in a subshell so cd doesn't affect this script
echo "[entrypoint] Starting Next.js server..."
(cd apps/web && node ../../node_modules/next/dist/bin/next start -p 3000) &
NEXTJS_PID=$!

# Start BullMQ worker + scheduler (Process 2)
echo "[entrypoint] Starting BullMQ worker..."
node packages/worker/dist/index.js &
WORKER_PID=$!

echo "[entrypoint] Both processes started (Next.js=$NEXTJS_PID, Worker=$WORKER_PID)"

# Exit as soon as either process dies so Docker can restart the container.
# wait -n requires bash 4.3+ (available in node:22-slim / Debian Bookworm).
wait -n
EXIT_CODE=$?

# Log which process is still running for easier debugging
if kill -0 "$NEXTJS_PID" 2>/dev/null; then
  echo "[entrypoint] Worker exited first (code=$EXIT_CODE) — shutting down Next.js"
  kill "$NEXTJS_PID" 2>/dev/null || true
else
  echo "[entrypoint] Next.js exited first (code=$EXIT_CODE) — shutting down worker"
  kill "$WORKER_PID" 2>/dev/null || true
fi

exit "$EXIT_CODE"
