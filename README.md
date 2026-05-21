# Agent Studio

A self-hosted AI workflow automation platform. Build, run, and schedule multi-step AI pipelines with a visual editor.

## Quick start

```bash
cp .env.example .env
docker compose up --build
```

Open **http://localhost:3001**.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — monorepo layout, runtime components, tech stack
- [Local Development](docs/LOCAL_DEV.md) — Docker workflow, env vars, troubleshooting
- [Deployment](docs/DEPLOYMENT.md) — production deployment with Railway, staging setup

## Tech stack

- **Frontend:** Next.js 15, React 19, Tailwind CSS 4
- **Backend:** Next.js API routes, BullMQ workers
- **Database:** SQLite via Drizzle ORM
- **Queue:** Redis + BullMQ
- **Monorepo:** Turborepo + pnpm
