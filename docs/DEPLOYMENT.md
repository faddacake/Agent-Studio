# Deployment

This guide covers deploying Itera Studio using the existing Dockerfile. The recommended path is **Railway** for simplicity, but the same Docker image works on any container platform.

## Production Docker image

The Dockerfile produces a production image that runs:
1. **Next.js** (`next start -p 3000`) — web app + API
2. **BullMQ worker** (`packages/worker/dist/index.js`) — background job processor

Both processes are managed by `entrypoint.sh`.

### Build the production image locally

```bash
docker build -t ai-studio .
```

### Test it locally

```bash
# Start Redis
docker compose up redis -d

# Run production image
docker run --rm \
  -p 3001:3000 \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  -e DATA_DIR=/data \
  -e NODE_ENV=production \
  -v ai-studio-data:/data \
  ai-studio
```

## Railway (recommended)

Railway auto-detects the Dockerfile and handles builds, deploys, and networking.

### Setup

1. Push your repo to GitHub.
2. Create a new project on [railway.app](https://railway.app).
3. Add a **Redis** service from the Railway marketplace.
4. Add a new service from your GitHub repo.
5. Set environment variables:

| Variable    | Value                                          |
|-------------|------------------------------------------------|
| `REDIS_URL` | Use Railway's `${{Redis.REDIS_URL}}` reference |
| `DATA_DIR`  | `/data`                                        |
| `NODE_ENV`  | `production`                                   |
| `PORT`      | `3000`                                         |

6. Add a persistent volume mounted at `/data` for SQLite and assets.
7. Deploy.

### Health check

Set the health check path to `/api/health` in Railway's service settings.

## Staging environment

Use the same Docker image with a separate Railway project (or environment):

1. Create a second Railway project named `ai-studio-staging`.
2. Connect the same GitHub repo but deploy from a `staging` branch.
3. Use a separate Redis instance and volume.
4. Set `NODE_ENV=production` (staging still runs production builds).

This gives you an isolated staging environment with the same infrastructure.

## Alternative platforms

The same Dockerfile works on:

- **Fly.io** — `fly launch`, add Redis via Upstash, add a volume for `/data`
- **Render** — Docker deploy, add Redis add-on, add disk for `/data`
- **AWS ECS** — Push image to ECR, create task definition + service, use ElastiCache for Redis, EFS for `/data`

### Key requirements for any platform

1. **Redis** — required for BullMQ job queue
2. **Persistent volume at `/data`** — SQLite database and uploaded assets
3. **Port 3000 exposed** — the container listens on 3000
4. **Health check** — `GET /api/health` should return 200

## Backup considerations

The SQLite database lives at `$DATA_DIR/ai-studio.db` (inside the `/data` volume). Back up this file regularly:

```bash
# Local backup
docker compose exec app cp /data/ai-studio.db /data/backups/ai-studio-$(date +%F).db
```

On Railway/Fly.io, schedule periodic volume snapshots or use `litestream` for continuous SQLite replication.
