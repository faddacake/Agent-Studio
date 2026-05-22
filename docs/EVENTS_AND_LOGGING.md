# Itera Studio Events and Logging

This document explains how events and logging should work across the Itera Studio engine and app.

## Purpose

Events and logs should make it easy to:

- understand workflow progress
- debug failed runs
- inspect node execution order
- trace artifact generation
- support SSE-driven UI updates

## 1. Event Model

Workflow runs emit lifecycle events.

Typical run-level events:
- run:queued
- run:started
- run:completed
- run:failed
- run:partial_failure
- run:cancelled
- run:budget_exceeded

Typical node-level events:
- node:queued
- node:started
- node:completed
- node:failed
- node:cancelled

Events should reflect actual engine state transitions.

## 2. Source of Truth

RunCoordinator is the source of truth for workflow lifecycle events.

NodeExecutor and executors may produce metadata, but run/node state changes should be represented through coordinator-managed events.

Do not create parallel event systems for execution state.

## 3. Logging Principles

Logs should be:

- structured
- minimal but useful
- tied to runId and nodeId where possible
- safe for development and debugging
- free of secrets or API keys

## 4. Minimum Useful Log Context

When logging execution work, prefer including:

- runId
- nodeId
- node type
- runtime kind
- status transition
- durationMs
- cost if applicable
- artifact path or filename if relevant

## 5. SSE Integration

The app consumes workflow events through SSE.

Flow:

RunCoordinator events → SSE endpoint → frontend snapshot hook → UI panels

The UI should rely on event/state data already emitted by the engine rather than inventing separate frontend-only execution state.

## 6. Artifact Logging

Artifact creation should log only safe references.

Allowed:
- filename
- mimeType
- width/height
- local path if repo conventions allow

Do not log raw binary contents.

## 7. Provider Logging

External provider integrations should log:

- provider name
- model
- request start
- request completion/failure
- duration
- cost if known

Do not log:
- API keys
- bearer tokens
- sensitive request payloads unless explicitly needed in local debug mode

## 8. Debugging Guidance

When debugging execution issues, inspect in this order:

1. buildExecutionGraph()
2. RunCoordinator state transitions
3. emitted events
4. NodeExecutor routing
5. executor-specific behavior
6. artifact output
7. SSE/UI rendering

## 9. Design Constraints

- Keep one coherent event model
- Avoid duplicate status tracking systems
- Prefer deterministic, testable event flows
- Keep logs useful without becoming noisy
