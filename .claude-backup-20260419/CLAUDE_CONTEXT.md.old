# AI Studio — Claude Context

This repository contains **AI Studio**, a self-hosted visual workflow builder for AI pipelines.

Architecture has already been established.  
Do NOT re-audit the repository unless explicitly instructed.

## Core Systems

Node Platform
- NodeDefinition
- NodeRegistry
- capability nodes
- provider nodes
- utility nodes

Execution Engine
- buildExecutionGraph()
- RunCoordinator
- executor runtime dispatch

Candidate Data Contract
- CandidateItem
- CandidateCollection
- CandidateSelection

Capability Nodes
- ClipScoring
- Ranking
- SocialFormat
- ExportBundle

UI
- React Flow workflow canvas
- schema-driven inspector
- Zustand workflow store
- debugger panel

## Current Pipeline

Prompt → ImageGen → ClipScoring → Ranking → SocialFormat → ExportBundle

## Rules

1. Extend the existing architecture.
2. Do not redesign systems.
3. Inspect only files needed for the task.
