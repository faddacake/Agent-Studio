# Architecture

Itera Studio is a Turborepo + pnpm monorepo that ships a Next.js web app backed by a BullMQ worker and Redis.

## Monorepo layout

```
ai-studio/
  apps/
    web/            Next.js 15 app (UI + API routes)
  packages/
    adapters/       External service adapters (AI providers, etc.)
    crypto/         Encryption & key management
    db/             Drizzle ORM + SQLite schema & migrations
    engine/         Workflow execution engine
    shared/         Shared types, constants, utilities
    worker/         BullMQ job processor
```

## Runtime components

```
                    +-----------+
  [Browser] ------> | apps/web  |  (Next.js, port 3000)
                    +-----+-----+
                          |
                          | enqueue jobs / read results
                          v
                    +-----+-----+
                    |   Redis   |  (port 6379)
                    +-----+-----+
                          ^
                          | consume jobs
                          |
                   +------+-------+
                   | packages/    |
                   | worker       |  (BullMQ processor)
                   +--------------+

  Persistent data:  /data  (SQLite DB, assets, config, backups)
```

### apps/web

The Next.js application serves the UI and exposes API routes for authentication, workflow management, and health checks. It enqueues background jobs into Redis via BullMQ.

### packages/worker

A long-running Node.js process that consumes jobs from Redis queues. It uses the engine and adapters packages to execute AI workflows.

### packages/db

Drizzle ORM with SQLite. The database file lives in the `/data` volume so it persists across container restarts.

### packages/engine

The workflow execution engine. Orchestrates node-by-node execution of user-defined AI pipelines.

### packages/adapters

Adapters for external AI providers (OpenAI, Anthropic, etc.). Provides a unified interface for the engine.

### packages/crypto

Handles master key derivation, encryption of stored API keys, and license validation.

### packages/shared

Shared TypeScript types, constants, and utility functions used across packages.

## Key technology choices

| Concern        | Choice                    |
|----------------|---------------------------|
| Monorepo       | Turborepo + pnpm          |
| Web framework  | Next.js 15 (App Router)   |
| Styling        | Tailwind CSS 4            |
| Database       | SQLite via Drizzle ORM    |
| Job queue      | BullMQ + Redis            |
| Runtime        | Node.js 22                |
| Container      | Docker + Docker Compose   |
