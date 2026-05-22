# Itera Studio — Master Context Prompt

You are assisting with the development of **Itera Studio**, a self-hosted visual workflow builder for AI image and video pipelines.

Before making any changes, read the following files in the repository:

/docs/PRD.md
/docs/PROJECT_MEMORY.md
/docs/ARCHITECTURE.md
/docs/TASKS.md

These documents define the product requirements, architecture, and current implementation state.

You must treat them as the **source of truth** for all decisions.

---

# Product Overview

Itera Studio is a **self-hostable visual workflow builder** that allows users to chain together AI models into multi-step pipelines using a drag-and-drop node editor.

Example pipeline:

Prompt → Flux → Nano Banana → Kling → Upscale → Export

Users provide their own API keys for providers like Replicate, Fal AI, Stability, and OpenAI.

Itera Studio **does not run inference itself** and does **not charge compute markups**.

The application runs locally using Docker.

---

# Key Product Principles

1. Self-hosted first
2. Provider agnostic
3. Bring-your-own API keys
4. Visual node workflows
5. No compute markup
6. Lifetime license model

---

# Technical Stack

Frontend:
- Next.js (App Router)
- TypeScript
- React Flow
- Zustand
- Tailwind

Backend:
- Next.js API routes
- BullMQ job queue
- Redis
- SQLite via Drizzle ORM

Storage:
- local filesystem
- Docker volumes

---

# Architecture Overview

Workflows are stored as JSON DAG graphs.

Execution engine responsibilities:

1. parse workflow graph
2. topological sort nodes
3. schedule execution
4. dispatch jobs to BullMQ
5. collect outputs
6. store run history

Parallel branches should execute concurrently.

---

# Provider Adapter System

Each provider adapter implements:
ProviderAdapter

Methods:
validateKey()
listModels()
getModelSchema()
runPrediction()
getPredictionStatus()
cancelPrediction()
estimateCost()

Adapters live in:
/packages/adapters

Adapters must be **provider-agnostic** and follow the interface strictly.

---

# Important Constraints

Itera Studio **never**:

- runs inference locally
- trains models
- stores provider API keys in plaintext
- sends telemetry without user consent

---

# Workflow Execution Rules

Workflow runs must support:

- DAG execution
- parallel nodes
- retry logic
- resume from failure
- timeout handling

Node state machine:
pending
queued
running
completed
failed
cancelled

---

# Coding Rules

When writing code:

1. Follow existing project structure.
2. Keep adapters modular.
3. Avoid tight coupling between UI and execution engine.
4. Prefer TypeScript type safety.
5. Keep code readable and maintainable.
6. Do not introduce new dependencies without justification.

---

# Before Writing Code

Always:

1. Check the relevant task in `/docs/TASKS.md`.
2. Confirm it aligns with the PRD.
3. Verify the architecture allows the change.

If there is ambiguity, ask clarifying questions before implementing.

---

# Output Requirements

When implementing changes:

1. Show modified files.
2. Show complete code for modified sections.
3. Explain reasoning briefly.
4. Avoid unnecessary refactors unless required.

---

# Current Development Phase

Itera Studio is currently in **Phase 2** development.

Active work includes:

- model selection dropdowns
- CLIP scoring
- social media formatting
- export bundles
- growth loop features

Focus on completing Phase 2 before expanding scope.

---

# Important

Do not introduce scope creep.

Follow the PRD strictly unless explicitly instructed otherwise.
