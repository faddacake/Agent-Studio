# Itera Studio Engine Rules

These rules must be followed when modifying the engine.

## 1. Orchestration

The execution engine is graph-driven.

Execution flow:
WorkflowGraph → buildExecutionGraph() → RunCoordinator → NodeExecutor

Do not redesign orchestration logic unless explicitly instructed.

## 2. Node Execution

Nodes execute through the NodeExecutor registry.

Runtime kinds:
- local
- capability
- provider

New node types must register through the existing executor registration system.

Do not introduce alternate execution paths.

## 3. Artifacts

Binary outputs must never be returned as raw Buffer.

All binary outputs must be normalized to:

ArtifactRef

ArtifactRef objects must be JSON-serializable.

## 4. Generators

All generation must use the GeneratorAdapter abstraction.

Providers must implement:

GeneratorAdapter.generate()

Supported adapters:
- MockGeneratorAdapter
- FalGeneratorAdapter

Do not call external APIs directly from nodes.

## 5. Workflow Nodes

Node routing uses:

params.__nodeType

This determines which executor handles the node.

Do not change this convention without updating the coordinator.

## 6. Tests

All engine changes must preserve:

- deterministic behavior
- passing test suite
- orchestration semantics

New features should include targeted tests following existing patterns.

## 7. Scope Control

Prefer minimal changes.

Avoid refactoring unrelated modules during feature work.

Follow existing architecture and conventions.
