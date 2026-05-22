# PROJECT CONTEXT — Itera Studio

Last Updated: {{DATE}}

---

## 1. Project Overview

Project Name: Itera Studio  
Owner: Ben Harrelson  
Purpose: All-in-one AI content creation and automation platform.

Primary Goal:
Build a scalable system for generating, scoring, formatting, and exporting AI-generated content for growth and monetization.

---

## 2. Current Phase

Status: Phase 2 — Engagement & Growth Systems

Active Focus:
- CLIP-based result quality scoring
- Automated social media formatting
- One-click export bundles
- Built-in growth loop features

Previous Phase:
- Multi-model generation
- Prompt builder
- UI workflow foundation

---

## 3. Tech Stack

Frontend:
- Next.js (App Router)
- React
- Tailwind CSS

Backend:
- Node.js
- API Routes / Server Actions
- Redis (queue/cache)

Infrastructure:
- Docker / Docker Compose
- Local Dev on macOS
- GitHub Repo

AI / Models:
- OpenAI
- Claude
- Gemini
- Flux / ElevenLabs
- Veo (planned)

---

## 4. System Architecture (High Level)

User → Web UI → API Layer → AI Providers → Processing Engine → Scoring → Export → Growth Loop → Analytics

Key Services:
- Generation Orchestrator
- Scoring Engine
- Export Manager
- Growth Engine

---

## 5. Current Objectives (Short-Term)

Priority 1:
Implement Phase 2 modules:
- CLIP scoring service
- Social format templates
- Export presets
- Engagement triggers

Priority 2:
Stability & performance:
- Reduce latency
- Improve caching
- Error handling

Priority 3:
Monetization groundwork:
- Usage tiers
- Token tracking
- Billing hooks

---

## 6. Repository Structure (Simplified)

/apps/web        → Frontend UI  
/apps/api        → Backend routes  
/packages/core   → Shared logic  
/packages/ai     → Model adapters  
/packages/export → Export bundles  
/packages/score  → Scoring logic  

---

## 7. Coding Standards

- Prefer small, composable functions
- TypeScript-first
- Functional over class-based
- Clear separation of concerns
- Minimal dependencies
- Comment only when necessary

---

## 8. Claude / LLM Usage Policy

Default Mode:
- Minimal tokens
- Diffs only
- No explanations
- Silent execution

Prompt Header:

"You are a senior engineer.

Rules:
- Minimal tokens
- Diffs only
- No explanations
- No restating
- Silent execution
- Assume prior context

Output only required changes."

---

## 9. Active TODO

[ ] Implement CLIP scoring pipeline  
[ ] Wire social formatting presets  
[ ] Build export bundle generator  
[ ] Add engagement loop triggers  
[ ] Optimize token usage  
[ ] Add usage analytics  
[ ] Prepare beta onboarding flow  

---

## 10. Known Issues / Risks

- Token burn rate on Claude
- Long context threads
- Incomplete error recovery
- Model API rate limits
- Export edge cases

---

## 11. Session Restart Instructions

When starting a new LLM session:

1. Paste this file
2. Say: "Assume PROJECT_CONTEXT.md is authoritative."
3. Give task in one sentence
4. Request diff output only

---

## 12. Notes

- This file is the single source of truth.
- Update after major milestones.
- Keep concise.
- Optimize for fast onboarding of AI agents.
