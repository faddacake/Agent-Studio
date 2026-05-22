# Product Requirements Document (PRD)

## 1. Product Overview

Itera Studio is a self-hostable, visual workflow-builder that lets creators and teams chain AI image and video models — such as Flux, Nano Banana, Kling, PixVerse, and Sora — into multi-step pipelines using a drag-and-drop node editor. Users bring their own API keys for inference providers (Replicate, Fal AI, etc.) and pay those providers directly for compute. The application ships as a single Docker image, stores all data locally, and requires no recurring subscription — users purchase a one-time lifetime license.

## 2. Problem Statement

Creators who want to combine multiple AI models into a single production pipeline today must write custom scripts, juggle multiple provider dashboards, and manually shuttle outputs between services. Existing tools either lock users into a single provider's ecosystem, charge per-generation markups on top of provider costs, or require significant engineering skill to orchestrate. Itera Studio eliminates these pain points by providing a visual, provider-agnostic orchestration layer that runs entirely on the user's own infrastructure, with no middleman markup on compute.

## 3. Target Users

- **Solo Creators / Artists**: Freelance illustrators, concept artists, and social-media content creators who use AI-generated imagery and video as part of their creative process. They need fast iteration without writing code.
- **Small Creative Studios (2–15 people)**: Agencies and studios producing marketing assets, short-form video, or game art. They need shared workflows, role-based access, and predictable costs.
- **AI Hobbyists / Power Users**: Technically curious individuals who experiment with new models frequently. They value flexibility, self-hosting, and avoiding vendor lock-in.
- **Content Production Teams**: Teams producing high volumes of AI-assisted content (e.g., e-commerce product shots, YouTube thumbnails). They need batch processing, templates, and cost visibility.

## 4. Primary Use Cases

1. **Image-to-Video Pipeline**: A creator uploads a reference image, runs it through Flux for style transfer, then feeds the result into Kling to generate a 5-second animated video.
2. **Batch Product Photography**: An e-commerce team loads 50 product photos, applies a consistent background-replacement workflow using Nano Banana, and exports all results in one run.
3. **Iterative Prompt Refinement**: An artist builds a workflow with a single image-generation node, tweaks prompts and parameters, and compares outputs side-by-side across multiple runs.
4. **Multi-Model A/B Testing**: A user creates parallel branches in a workflow — one using Flux, another using SDXL via Replicate — to compare quality and cost for the same prompt.
5. **Video Post-Processing Chain**: A filmmaker generates a base video with Sora, upscales it with a super-resolution model, and applies frame interpolation — all in one pipeline.
6. **Template Sharing Across a Team**: A studio lead builds a "hero image" workflow template, publishes it to the team workspace, and teammates run it with their own inputs.
7. **Cost-Constrained Experimentation**: A hobbyist sets a per-run budget cap of $2, and the system warns or halts execution if estimated costs exceed the limit before any API calls are made.
8. **Scheduled / Recurring Runs**: A content team schedules a daily workflow that generates social-media assets from a spreadsheet of prompts and uploads results to cloud storage.

## 5. Non-Goals

- **Training or fine-tuning models**: Itera Studio orchestrates inference only; it does not train, fine-tune, or host models.
- **Building a model marketplace**: The product does not curate, rank, or sell access to models. It connects to providers the user already has accounts with.
- **Real-time collaborative editing**: V1 does not support multiple users editing the same workflow simultaneously (Google-Docs-style). Collaboration is via sharing/importing workflows.
- **Mobile-native app**: The UI is a responsive web application, not a native iOS/Android app.
- **Replacing provider dashboards**: Itera Studio does not replicate billing management, usage analytics, or account settings that providers already offer.
- **Hosting inference compute**: The product never runs model inference itself. All compute happens on third-party provider infrastructure.
- **LLM chat / text-generation workflows**: V1 focuses exclusively on image and video generation models. Text/LLM orchestration is out of scope.

## 6. User Stories & Acceptance Criteria

### US-1: Connect a Provider API Key
**As a** user, **I want to** add my Replicate API key to Itera Studio **so that** I can run models hosted on Replicate.

- **Given** I am on the Settings > Providers page,
- **When** I enter a valid Replicate API key and click Save,
- **Then** the system validates the key against the provider's API, displays a success confirmation, and stores the key encrypted at rest.

### US-2: Build a Two-Node Workflow
**As a** creator, **I want to** visually connect an image-generation node to a video-generation node **so that** the output of the first feeds into the second automatically.

- **Given** I have dragged a Flux node and a Kling node onto the canvas,
- **When** I draw a connection from Flux's "image output" port to Kling's "image input" port,
- **Then** the connection is validated (types match), rendered on canvas, and the workflow is auto-saved.

### US-3: Run a Workflow End-to-End
**As a** user, **I want to** click "Run" on my workflow **so that** all nodes execute in dependency order and I see results.

- **Given** I have a valid, fully-connected workflow with all required inputs provided,
- **When** I click the Run button,
- **Then** each node executes in topological order, progress is shown per-node, and final outputs are displayed in a results panel.

### US-4: View Cost Estimate Before Running
**As a** cost-conscious user, **I want to** see an estimated cost before running a workflow **so that** I can decide whether to proceed.

- **Given** I have a complete workflow ready to run,
- **When** I click "Estimate Cost" or hover over the Run button,
- **Then** the system displays per-node and total estimated costs based on current provider pricing and selected parameters.

### US-5: Resume a Partially Failed Workflow
**As a** user, **I want to** resume a workflow that failed mid-execution **so that** I don't re-pay for nodes that already completed successfully.

- **Given** a workflow run where node 3 of 5 failed due to a transient API error,
- **When** I click "Resume" on the failed run,
- **Then** execution restarts from the failed node, reusing cached outputs from nodes 1 and 2.

### US-6: Use a Pre-Built Template
**As a** new user, **I want to** start from a template workflow **so that** I can be productive without building from scratch.

- **Given** I am on the "New Workflow" screen,
- **When** I select the "Image-to-Video" template,
- **Then** a pre-configured workflow loads on the canvas with placeholder inputs and sensible default parameters.

### US-7: Export and Import a Workflow
**As a** team lead, **I want to** export a workflow as a JSON file and share it with teammates **so that** they can import and run it in their own Itera Studio instance.

- **Given** I have a working workflow,
- **When** I click Export > Download JSON,
- **Then** the workflow definition (nodes, connections, parameters — but not API keys) is saved as a portable JSON file.

### US-8: Set a Per-Run Budget Cap
**As a** user, **I want to** set a maximum spend per workflow run **so that** I never accidentally exceed my budget.

- **Given** I have set a budget cap of $5.00 in workflow settings,
- **When** the running cost estimate exceeds $5.00 during execution,
- **Then** the system pauses execution before the next billable node and asks for confirmation to continue.

### US-9: View Run History
**As a** user, **I want to** see a history of past workflow runs **so that** I can compare outputs and costs over time.

- **Given** I navigate to the History tab of a workflow,
- **When** the page loads,
- **Then** I see a chronological list of runs with status, duration, total cost, and thumbnail previews of outputs.

### US-10: Self-Host via Docker
**As a** technically savvy user, **I want to** deploy Itera Studio on my own server using Docker **so that** I maintain full control over my data.

- **Given** I have Docker installed on a Linux server,
- **When** I run `docker compose up` with the provided compose file,
- **Then** Itera Studio starts, is accessible on the configured port, and persists data to a mounted volume.

## 7. MVP Scope

- **Node editor canvas**: Drag-and-drop visual workflow builder with zoom, pan, snap-to-grid, and undo/redo.
- **Core node types**: Image Generation, Video Generation, Image Input (upload), Output/Preview, and local utility nodes (resize, crop, format conversion, basic compositing, prompt/template text construction).
- **Provider adapters**: Replicate and Fal AI adapters with support for at least 3 models each (e.g., Flux, SDXL, Kling).
- **API key management**: Encrypted storage of provider API keys per user.
- **Sequential and parallel DAG execution**: Run nodes in dependency order, with support for parallel branches.
- **Run progress and results**: Real-time progress indicators per node, with output preview in the results panel.
- **Cost estimation**: Pre-run cost estimates based on provider pricing data.
- **Run history**: Persistent log of past runs with status, cost, and output thumbnails.
- **Workflow persistence**: Auto-save workflows to local database; manual export/import as JSON.
- **Single-user Docker deployment**: One-command Docker Compose setup with SQLite and local file storage.
- **5 starter templates**: Pre-built workflows covering common image and video generation patterns.
- **Basic error handling**: Retry failed nodes (configurable per node: 0–3 retries), resume from failure.

## 8. Post-MVP Scope

- **Multi-user & teams**: User accounts, workspaces, role-based access (admin, editor, viewer).
- **Additional providers**: RunPod, Together AI, Stability AI, OpenAI (DALL-E, Sora), Runway.
- **Conditional branching nodes**: If/else logic based on metadata (e.g., aspect ratio, file size).
- **Batch processing**: Run a workflow across a list of inputs (CSV, folder of images).
- **Scheduled / cron workflows**: Trigger workflows on a recurring schedule.
- **Webhook triggers**: Start a workflow via external HTTP webhook.
- **Community template marketplace**: Browse, share, and rate workflow templates.
- **Plugin SDK**: Allow third-party developers to build custom nodes and provider adapters.
- **PostgreSQL support**: Optional migration from SQLite for higher-concurrency deployments.
- **Real-time collaboration**: Multiple users editing a workflow simultaneously.
- **Notification integrations**: Slack, Discord, email notifications on run completion or failure.
- **Asset management**: Built-in media library for organizing generated outputs.
- **LoRA / model-version selection**: Node-level selection of specific model versions and LoRA weights.

## 9. UX & Workflow Builder Requirements

### Node Editor
- Canvas powered by a mature React-based node graph library (e.g., React Flow).
- Nodes are rectangular cards showing: model name, provider icon, key parameters, status indicator, and thumbnail of last output.
- Connections (edges) are drawn between typed ports. Invalid connections (e.g., video-out to text-in) are visually rejected.
- Keyboard shortcuts: Delete (remove node), Ctrl+Z/Cmd+Z (undo), Ctrl+C/V (copy/paste nodes), Space+drag (pan).

### Port Typing
- Ports are typed: `image`, `video`, `text` (prompt), `number`, `json`. Type mismatches prevent connection.
- Automatic format conversion nodes are suggested when types are compatible but not identical (e.g., image resize).

### Templates
- Templates appear in a "New Workflow" gallery with preview images and descriptions.
- Applying a template creates an editable copy; the original template is immutable.
- Users can save any workflow as a personal template.

### Debugging & Inspection
- Clicking a node during or after a run opens an inspector panel showing: input values, output preview, raw API request/response, execution time, and cost.
- Nodes in error state display the error message inline and in the inspector.

### Undo/Redo
- Full per-action undo/redo for structural edits (node add/remove, connections, grouping, layout changes).
- Batched undo/redo for parameter changes: rapid edits to the same field are coalesced by a time window into a single undo step.

### Run History
- Each workflow maintains a paginated run history.
- Runs can be compared side-by-side (select two runs → diff view showing parameter changes and output differences).

## 10. Technical Architecture

### Frontend
- **Framework**: Next.js (App Router) with TypeScript.
- **Node editor**: React Flow for the visual canvas.
- **State management**: Zustand for workflow and UI state.
- **Styling**: Tailwind CSS with a design-system of reusable components.
- **Real-time updates**: Server-Sent Events (SSE) for streaming run progress from the backend.

### Backend
- **Runtime**: Monolithic Next.js application (API routes + frontend) for MVP. Code is structured with a clean separation between frontend and backend modules so the backend can be extracted into a standalone service (e.g., Fastify) post-MVP without a rewrite.
- **Language**: TypeScript end-to-end.
- **Database**: SQLite (via Drizzle ORM) for MVP; PostgreSQL as a post-MVP option.
- **File storage**: Local filesystem (mounted Docker volume) for generated assets. S3-compatible storage as post-MVP option.
- **Job queue**: BullMQ (backed by a lightweight Redis container in the Docker Compose stack) for managing workflow execution.

### Provider Adapters
- Each provider adapter is a TypeScript module implementing a standard `ProviderAdapter` interface (see Section 11).
- Adapters live in a `/adapters` directory and are registered at startup.

### Orchestration Engine
- A DAG executor that reads the workflow graph, determines execution order (topological sort), and dispatches node executions to the job queue.
- Supports parallel execution of independent branches.
- Handles retries, timeouts, and partial-failure resume (see Section 12).

### Secrets Management
- API keys are encrypted at rest using AES-256-GCM.
- On first launch, a strong random master encryption key is auto-generated and persisted in local configuration. Advanced users may override via `MASTER_KEY` environment variable. Tooling is provided for key rotation and re-encryption.
- Keys are decrypted in memory only at the moment of API call execution.

### Deployment
- Single `docker-compose.yml` with three services: `app` (Next.js), `redis` (BullMQ backend), and `volume mounts` for SQLite DB and asset storage.

## 11. Provider Adapter System

### Plugin Model
- Each adapter is a self-contained TypeScript module exporting a class that implements the `ProviderAdapter` interface.
- Adapters are loaded at application startup from the `/adapters` directory via dynamic import.

### Interface Definition
```typescript
interface ProviderAdapter {
  id: string;                          // e.g., "replicate"
  displayName: string;                 // e.g., "Replicate"
  icon: string;                        // path to provider icon
  validateKey(apiKey: string): Promise<boolean>;
  listModels(): Promise<ModelDefinition[]>;
  getModelSchema(modelId: string): Promise<NodeSchema>;
  runPrediction(params: PredictionRequest): Promise<PredictionResult>;
  getPredictionStatus(predictionId: string): Promise<PredictionStatus>;
  cancelPrediction(predictionId: string): Promise<void>;
  estimateCost(params: PredictionRequest): CostEstimate;
}
```

### Model Definition & Pricing
- Each model exposed by an adapter declares its input/output port types, configurable parameters (with defaults, ranges, and descriptions), and pricing metadata.
- This schema drives the dynamic rendering of node UIs — no frontend changes are needed to support a new model.
- **Pricing data**: Each adapter ships with versioned default pricing metadata. The system checks for user/admin overrides in the database first, then falls back to adapter defaults. If neither exists, estimates are marked as "approximate" with a warning. Cost estimation never blocks execution.

### Versioning
- Adapters declare a `schemaVersion` field. The orchestration engine validates compatibility before execution.
- Breaking changes to the adapter interface increment the schema version, and a migration guide is provided.

### Testing
- Each adapter ships with integration tests that run against the real provider API (gated behind an environment flag).
- A mock adapter (`mock-provider`) is included for local development and CI testing.

## 12. Job Orchestration & Reliability

### DAG Execution
- The orchestration engine parses the workflow JSON into a directed acyclic graph (DAG).
- Nodes are scheduled using topological sort. Independent branches execute in parallel via concurrent BullMQ jobs.
- A run coordinator tracks the state of each node: `pending → queued → running → completed | failed | cancelled`.

### Retries
- Each node has a configurable retry count (default: 1, max: 3) and retry delay (exponential backoff starting at 5 seconds).
- Only transient errors (HTTP 429, 500, 502, 503, 504, network timeouts) trigger automatic retries. Validation errors (400) do not.

### Resume
- When a run fails, the system snapshots the state of all completed nodes (inputs, outputs, metadata).
- The "Resume" action re-validates the workflow, skips completed nodes, and re-executes from the first failed or pending node.

### Partial Failures
- If one branch of a parallel execution fails, other independent branches continue to completion.
- The run is marked as `partial_failure` with clear indication of which branches succeeded and which failed.

### Timeouts
- Each node has a configurable timeout (default: 5 minutes, max: 30 minutes). If a provider does not return a result within the timeout, the node is marked as failed and retries are attempted.

### Cancellation
- Users can cancel a running workflow at any time. The system sends cancellation requests to providers for any in-flight predictions and marks remaining nodes as `cancelled`.

## 13. Security & Compliance

### API Key Storage
- API keys are encrypted at rest using AES-256-GCM.
- On first launch, a strong random master encryption key is auto-generated and persisted securely in local configuration. Advanced users may override via `MASTER_KEY` environment variable. Key derivation uses PBKDF2 (100,000 iterations).
- Tooling is provided for key rotation and re-encryption of all stored secrets.
- Keys are never logged, never included in error reports, and never returned in API responses after initial storage.

### Transport Security
- All communication between the browser and the Itera Studio backend must occur over HTTPS (enforced via reverse proxy in production deployments).
- All outbound API calls to providers use HTTPS.

### User Isolation (Post-MVP)
- In multi-user mode, each user's API keys, workflows, and run history are isolated by user ID.
- Role-based access controls: Admin (full access), Editor (create/run workflows), Viewer (view-only).

### Audit Logs
- Every API key addition/removal, workflow run, and configuration change is logged with timestamp, actor, and action.
- Logs are stored locally and are not transmitted externally.

### Provider TOS Compliance
- Itera Studio documentation includes a disclaimer that users are responsible for complying with each provider's Terms of Service.
- The application does not circumvent any provider rate limits or access controls.

### Dependency Security
- Automated dependency vulnerability scanning (e.g., `npm audit`, Dependabot) in CI.
- Docker images are built from minimal base images (e.g., `node:alpine`) and scanned for CVEs.

## 14. Deployment & Self-Hosting

### Docker Deployment
- Primary deployment method: `docker compose up -d` with a single `docker-compose.yml` file.
- Services: `app` (Next.js application), `redis` (BullMQ queue backend).
- **Multi-arch images**: UI, API, and control-plane services ship as multi-arch (x86_64 + ARM64) Docker images from MVP to support Apple Silicon and ARM servers.
- Data persistence: SQLite database and generated assets stored on mounted Docker volumes.
- Environment configuration via `.env` file with sensible defaults and clear documentation.

### System Requirements
- Minimum: 1 CPU core, 1 GB RAM, 10 GB disk.
- Recommended: 2 CPU cores, 2 GB RAM, 50 GB disk (for asset storage).

### Configuration
- All configuration via environment variables: `PORT`, `MASTER_KEY`, `DATA_DIR`, `LOG_LEVEL`, `MAX_CONCURRENT_RUNS`.
- No external services required beyond the included Redis container.

### Backups
- SQLite database and asset directory can be backed up by copying the Docker volume or mounted directory.
- Documentation includes recommended backup strategies (cron + rsync, Docker volume snapshots).

### Updates
- Users pull the latest Docker image and restart: `docker compose pull && docker compose up -d`.
- Database migrations run automatically on startup.
- Changelog published with each release; breaking changes are highlighted.

### Reverse Proxy
- Documentation includes sample configurations for Nginx, Caddy, and Traefik for HTTPS termination and custom domain setup.

## 15. Cost Estimation & Usage Visibility

### Pre-Run Estimates
- Before execution, the system calculates estimated cost per node based on: provider pricing data, selected model, and input parameters (e.g., resolution, duration, number of steps).
- Pricing data is maintained in adapter configuration files and can be manually updated by the user if provider pricing changes.
- Estimates are displayed per-node and as a workflow total in the Run Confirmation dialog.

### Budget Caps
- Users can set a per-run budget cap at the workflow level.
- Default behavior: **hard-stop** when the cap is exceeded (remaining nodes are cancelled). This is safest for unattended/scheduled runs.
- Per-workflow override: users can switch to **pause-and-prompt** mode for interactive sessions, which pauses before the next billable node and waits for manual confirmation.
- Budget events trigger in-app notifications (and optionally email/webhook post-MVP).

### Usage Reporting
- A dashboard shows: total spend per provider, per workflow, and per time period (day/week/month).
- Data is computed from run history records; no external analytics services are used.

### Cost Alerts
- Users can configure alerts: "Warn me if a single run exceeds $X" or "Warn me if weekly spend exceeds $Y."
- Alerts are displayed in-app (and optionally via webhook/notification post-MVP).

### Accuracy Disclaimer
- Cost estimates are approximate and based on locally-stored pricing data. Actual charges are determined by the provider. This disclaimer is shown wherever estimates appear.

## 16. Templates & Presets

### Default Templates (MVP)
1. **Text-to-Image**: Single Flux node with prompt input and image output.
2. **Image-to-Image Style Transfer**: Upload image → Flux img2img → output.
3. **Image-to-Video**: Generate image with Flux → animate with Kling.
4. **Multi-Model Image Comparison**: Same prompt → parallel Flux and SDXL nodes → side-by-side output.
5. **Video Upscale Pipeline**: Generate video with Kling → upscale with a super-resolution model.

### Template Structure
- Templates are stored as JSON workflow definitions with metadata: name, description, category, preview image, required providers.
- Templates ship with the application and are versioned alongside releases.
- **Provider compatibility**: When a template references a model on a provider the user hasn't configured, the system detects the mismatch and suggests functionally equivalent models from the user's available providers. Substitutions require explicit user confirmation — models are never auto-swapped silently. Capability differences and potential output variation are clearly displayed before execution.

### User Templates
- Any workflow can be saved as a personal template.
- Personal templates are stored in the same database and appear alongside built-in templates with a "My Templates" filter.

### Marketplace Strategy (Post-MVP)
- A community template hub where users can publish, discover, and import workflow templates.
- Templates are reviewed for quality before being featured.
- Revenue model: free to share; optional "premium" templates from verified creators (revenue split TBD).

## 17. Licensing & Monetization

### Lifetime License Model
- One-time purchase grants perpetual usage rights and 24 months of feature updates.
- After the update period, the software continues to work indefinitely. Users may optionally renew update access at a discounted rate.
- Critical security and compatibility fixes remain available to all license holders regardless of renewal status.

### Pricing Tiers (Proposed)
- **Personal**: $99 — single user, all features, 24 months of updates.
- **Team**: $299 — up to 10 users, team features (workspaces, roles), 24 months of updates.
- **Enterprise**: Custom pricing — unlimited users, priority support, custom adapter development.

### License Enforcement
- License key validated at startup against a lightweight license server (single API call, cached locally).
- Offline grace period: the application continues to work for 30 days without reaching the license server.
- No telemetry or usage data is sent to the license server — only the license key and a machine hash.

### Optional Paid Services
- **Priority support**: Paid support plans with guaranteed response times.
- **Custom adapter development**: Paid service to build adapters for providers not yet supported.
- **Managed hosting**: A hosted version of Itera Studio for users who don't want to self-host (post-MVP, if demand warrants).

### Licensing Strategy
- Initial release under a **source-available license** (Fair Source / BSL-style): code is inspectable and modifiable but commercial redistribution is restricted.
- Maintains proprietary control of orchestration and adapter systems during early growth.
- Transition to **open-core (AGPL + commercial license)** will be reassessed after achieving product-market fit and establishing a plugin ecosystem.

## 18. Constraints & Assumptions

### Technical Constraints
- The application is designed for single-server deployment in MVP. Horizontal scaling is not a goal for V1.
- SQLite limits concurrent write throughput; this is acceptable for single-user / small-team usage.
- BullMQ requires Redis, which adds one container to the deployment stack.
- Generated assets are stored on local disk; large-scale asset management requires external storage (post-MVP).

### Provider Assumptions
- Providers (Replicate, Fal AI) offer stable, documented REST APIs with API key authentication.
- Provider pricing is relatively stable; significant pricing changes may require adapter updates.
- Providers do not block or rate-limit requests from self-hosted applications in a way that differs from standard API usage.

### Legal Assumptions
- Users are responsible for their own compliance with provider Terms of Service.
- The software does not generate, store, or transmit content that would create CSAM, copyright, or other legal liability for the operator.
- Lifetime license model is commercially viable for the target market.

### Operational Assumptions
- Target users are comfortable with basic Docker operations (pulling images, running compose files).
- Users have existing accounts and API keys with at least one supported provider.

## 19. Risks & Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Provider API breaking changes** | Adapters stop working; users cannot run workflows | Medium | Pin adapter versions to specific API versions; automated integration tests detect breakage early; adapter update turnaround < 48 hours |
| **Provider blocks self-hosted usage** | Users lose access to a provider | Low | Support multiple providers so users can switch; document provider TOS clearly |
| **Support burden from self-hosting** | Engineering time consumed by deployment issues | High | Comprehensive deployment docs; community forum; Docker-first approach minimizes environment variance |
| **Competition from provider-native tools** | Providers build their own workflow builders | Medium | Differentiate on multi-provider orchestration and data ownership; providers' tools will always be single-provider |
| **Pricing model doesn't sustain development** | Insufficient revenue | Medium | Validate pricing with early adopters; add optional recurring services (support, managed hosting) |
| **Security breach of stored API keys** | User API keys compromised | Low | AES-256-GCM encryption; keys never leave the user's server; security audit before launch |
| **Scope creep delays MVP** | Launch date slips | High | Strict MVP scope; weekly scope reviews; defer all post-MVP features ruthlessly |
| **Model output quality varies across providers** | Users blame Itera Studio for poor results | Medium | Clear attribution to provider/model; expose raw parameters; provide comparison tools |

## 20. Metrics & Telemetry

### Success Metrics
- **Activation rate**: % of users who complete at least one successful workflow run within 24 hours of installation.
- **Workflow complexity**: Average number of nodes per workflow (target: 3+ for active users).
- **Retention**: % of users who run at least one workflow per week over a 4-week period.
- **Template adoption**: % of new workflows created from templates vs. blank canvas.
- **Provider diversity**: Average number of distinct providers connected per user.

### Privacy-Respecting Analytics
- **Opt-in only**: No telemetry is collected unless the user explicitly enables it.
- **Aggregated and anonymous**: If enabled, only aggregate counts are collected (e.g., "workflows created this week: 12"), never workflow content, prompts, outputs, or API keys.
- **Local-first dashboard**: Usage statistics are computed and displayed locally in the app's admin panel, regardless of telemetry opt-in.
- **No third-party analytics**: No Google Analytics, Mixpanel, or similar services. If server-side telemetry is enabled, data is sent to a first-party endpoint only.

## 21. Open Questions

All initial open questions have been resolved through stakeholder interview. Decisions are incorporated into their respective sections above.

| # | Question | Resolution | Section Updated |
|---|----------|------------|-----------------|
| 1 | Monolith vs. separate backend | Monolith now, structured for later extraction | §10 |
| 2 | Adapter pricing data freshness | Hybrid: adapter defaults + user-editable overrides | §11 |
| 3 | License update-inclusion period | 24 months of feature updates; security fixes perpetual | §17 |
| 4 | Open source vs. proprietary | Source-available (BSL/Fair Source) initially; reassess post-PMF | §17 |
| 5 | ARM architecture support | Multi-arch (x86_64 + ARM64) from MVP for core services | §14 |
| 6 | Template provider compatibility | Suggest equivalents with explicit user confirmation; no silent swaps | §16 |
| 7 | Undo/redo granularity | Full per-action for structural edits; time-coalesced for parameter changes | §9 |
| 8 | Budget cap behavior | Default hard-stop; per-workflow override for pause-and-prompt | §15 |
| 9 | Utility nodes in MVP | Yes: resize, crop, format convert, compositing, prompt template | §7 |
| 10 | Master encryption key | Auto-generated on first launch; optional env var override; rotation tooling | §13 |
