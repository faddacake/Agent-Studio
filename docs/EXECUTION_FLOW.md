# Itera Studio Execution Flow

This document explains how a workflow run executes inside the Itera Studio engine.

## Overview

Execution is graph-driven and coordinated through a small set of core components.

Flow:

User → WorkflowGraph → ExecutionGraph → RunCoordinator → NodeExecutor → Executors → Outputs

## 1. Workflow Graph

A workflow is defined as a directed acyclic graph (DAG).

Nodes represent operations.
Edges represent data dependencies.

The graph is converted into an ExecutionGraph before runtime.

## 2. buildExecutionGraph()

buildExecutionGraph() validates and transforms the WorkflowGraph into an execution-ready structure.

Responsibilities:
- enforce DAG ordering
- identify node dependencies
- determine execution readiness

## 3. RunCoordinator

RunCoordinator manages the lifecycle of a workflow run.

Responsibilities:
- track run state
- dispatch nodes when dependencies resolve
- enforce budget rules
- emit events
- track node completion

## 4. NodeExecutor

NodeExecutor is responsible for executing a node.

It routes execution based on node runtime kind.

Supported runtime kinds:

- local
- capability
- provider

## 5. Executors

Executors perform the actual work.

Examples:

Local Executors
- resize
- crop
- format-convert

Capability Executors
- best-of-n generation

Provider Executors
- FalGeneratorAdapter
- MockGeneratorAdapter

## 6. Artifact Handling

Binary outputs are never returned as raw buffers.

All artifacts must be normalized to:

ArtifactRef

ArtifactRef objects are JSON-serializable and reference stored files.

Example:

ArtifactRef → local-file path

## 7. Downstream Data Flow

Node outputs are passed to downstream nodes via:

resolveNodeInputs()

Candidate-based workflows use:

CandidateCollection  
CandidateSelection

## 8. UI Flow

Generate page triggers workflow run.

Flow:

Generate Page → Run API → RunCoordinator → SSE Events → UI Debug Panel + Results Grid

ArtifactRefs are served through the artifacts API endpoint for browser rendering.

## 9. Design Constraints

- Execution must remain deterministic
- Nodes must not bypass the NodeExecutor
- Binary data must use ArtifactRef
- External providers must use GeneratorAdapter
