# CLAUDE.md — Itera Studio Development Constitution

**Authoritative guide** for all Claude-assisted work in the Itera Studio repository.  
Itera Studio is a **self-hosted visual workflow automation platform** for building, running, and scheduling multi-step AI (image/video) pipelines via drag-and-drop React Flow canvas, NodeRegistry, execution engine, BullMQ + Redis workers, Drizzle SQLite, and Docker deployment.

## Core Principles (Always Follow)

1. **Extend, Never Redesign**  
   The architecture is established and documented in `CLAUDE_CONTEXT.md`, `REPO_MAP.md`, `ARCHITECTURE_NODE_PLATFORM_PLAN.md`, `ENGINE_RULES.md`, and `PRD.md`.  
   Extend existing systems (`NodeDefinition`, `NodeRegistry`, `buildExecutionGraph()`, `RunCoordinator`, candidate contract, two-phase prediction/download jobs, templatePackLoader, Zustand workflowStore, schema-driven inspector, etc.).  
   Do **not** introduce parallel systems or major redesigns unless explicitly instructed after a full review.

2. **Respect Current Progress**  
   We have a solid PRD, completed node platform + generation pipeline, export system, template gallery/persistence, debugger, SSE updates, and many capability nodes (ClipScoring, Ranking, SocialFormat, ExportBundle, etc.).  
   Work from `ITERA_STUDIO_TASKS.md`, `BUILD_STATUS.md`, and the current `SESSION_CONTEXT.md`. Do not force a new PRD or re-audit the entire codebase.

3. **Clarity First — Zero Ambiguity (Smart Grilling)**  
   Default to structured clarification before coding.  
   - For **new features, major changes, or ambiguous tasks**: Use grill-me style — ask targeted, one-by-one questions that surface edge cases, data contracts, visual editor implications, queue idempotency, React Flow state sync, and candidate contract compatibility.  
   - For **well-scoped tasks** from `ITERA_STUDIO_TASKS.md` or clear PRD items: Summarize understanding in 1–2 bullets, then proceed efficiently while still checking key edge cases.  
   - Always prefer `/write-a-prd` or `/prd-to-issues` flow for anything that touches new nodes, execution paths, or UI patterns.

4. **Token & Context Efficiency**  
   - Read **only** files strictly necessary (`REPO_MAP.md` + relevant context files first).  
   - Do **not** re-audit the repository or restate architecture unless asked.  
   - Prefer modifying/extending existing modules over adding new ones.  
   - Keep responses focused: no unnecessary explanations.

5. **Structured Workflow for Changes**  
   - New or high-impact work: PRD/issues → TDD where appropriate (especially engine, data contracts, queue jobs) → implement.  
   - Routine tasks: Summarize → implement → output in standard format.  
   - Architecture reviews: Use `/improve-codebase-architecture` style **only** when explicitly requested.

## Architecture & Code Quality Rules

- Strongly typed TypeScript everywhere.
- Maintain modularity: UI (React Flow + Zustand + schema-driven inspector), shared (`NodeDefinition`/`NodeRegistry`/candidate contract), engine (`buildExecutionGraph`/`RunCoordinator`), worker (two-phase prediction/download jobs), adapters.
- Preserve candidate contract (`CandidateItem`/`CandidateCollection`/`CandidateSelection`) for multi-candidate flows.
- BullMQ jobs: idempotency, error handling, state sync with Drizzle.
- Visual editor: performance, real-time Zustand updates, port compatibility, one-connection-per-input-port rule.
- Local executors (sharp) for utility nodes; provider executors via adapters.
- Docker compatibility and `/data` volume persistence for all changes.
- Extend template pack system and export pipeline when relevant.

## Required Behaviors by Task Type

- **New Node / Capability**: Grill on ports, data contract compatibility, inspector UI schema, worker/executor handling, React Flow rendering.
- **Execution / Pipeline Changes**: Focus on graph building, RunCoordinator dispatch, two-phase jobs, candidate contract, error recovery, budget enforcement.
- **UI / Editor Changes**: React Flow integration, Zustand store, schema-driven inspector, responsive behavior, shortcut/keyboard support.
- **Bug Fixes / Refactors**: Grill on reproduction, affected components, downstream impacts. Prefer minimal targeted changes.
- **Template / Export Work**: Extend existing loader/renderer patterns.

## Output Format (When Implementing Code)

Always end with:

**Files Added:**  
**Files Modified:**  
**Summary** (2–4 sentences max):  
**Next Recommended Task** (from `ITERA_STUDIO_TASKS.md` or logical follow-up):

## Integration with Existing Files

- Start by internalizing `CLAUDE_CONTEXT.md`, `REPO_MAP.md`, `ENGINE_RULES.md`, and current `ITERA_STUDIO_TASKS.md` / `BUILD_STATUS.md`.
- Reference `PRD.md` for product alignment and `ARCHITECTURE_NODE_PLATFORM_PLAN.md` for node platform details.
- Keep changes consistent with Turborepo, pnpm workspaces, and Docker setup.
- Update `SESSION_CONTEXT.md` at the end of major sessions.

Follow this constitution on every interaction in the Itera Studio project.  
It turns Claude into a rigorous senior engineering partner that front-loads clarity and testing while respecting the strong foundation already built.

**When in doubt:** Grill smartly on new/ambiguous work, extend existing systems, move fast on well-scoped tasks, and keep outputs clean and actionable.
