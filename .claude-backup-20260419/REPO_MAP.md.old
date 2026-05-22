# AI Studio Repository Map

This file describes the repository layout so AI agents do not need to scan the entire codebase.

## Applications

apps/web
- Next.js frontend
- React Flow canvas editor
- schema-driven inspector
- debugger panel

## Core Packages

packages/shared
- NodeDefinition
- NodeRegistry
- candidate data contract
- shared schemas

packages/engine
- buildExecutionGraph()
- RunCoordinator
- capability executors
- scoring / ranking / social / export

packages/worker
- BullMQ workers
- node job processors

## Docs

docs/
- ARCHITECTURE_NODE_PLATFORM_PLAN.md
- SESSION_CONTEXT.md
- PRD.md
- technical_design.md

## Key Development Pattern

Nodes are registered in the NodeRegistry and executed by the engine.

Pipeline example:

Prompt → ImageGen → ClipScoring → Ranking → SocialFormat → ExportBundle

## Rules for AI agents

1. Inspect only files required for the task.
2. Do not scan the entire repository.
3. Extend existing architecture.
