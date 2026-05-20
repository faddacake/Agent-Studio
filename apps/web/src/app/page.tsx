import type { Metadata } from "next";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { Container } from "@/components/marketing/Container";
import { Section, SectionHeader } from "@/components/marketing/Section";
import { CTAButton } from "@/components/marketing/CTAButton";
import { FeatureGrid, FeatureCard } from "@/components/marketing/FeatureGrid";
import { Steps } from "@/components/marketing/Steps";
import { FAQ } from "@/components/marketing/FAQ";

export const metadata: Metadata = {
  title: "Itera Studio — Your AI Agency, On Your Hardware",
  description:
    "Multi-agent reasoning, persistent memory, web search, and video output — self-hosted in one Docker container with your own API keys. Lifetime license, no subscription.",
  openGraph: {
    title: "Itera Studio — Your AI Agency, On Your Hardware",
    description:
      "Chain reasoning agents, give them persistent memory, let them search the web and collaborate as teams — then output to video. Self-hosted. One-time license.",
    type: "website",
  },
};

export default function LandingPage() {
  return (
    <MarketingLayout>
      {/* ── Hero ── */}
      <section
        style={{
          padding: "100px 0 80px",
          background:
            "radial-gradient(ellipse at 50% 0%, rgba(59, 130, 246, 0.10) 0%, transparent 65%)",
        }}
      >
        <Container>
          <div
            style={{
              maxWidth: 760,
              marginLeft: "auto",
              marginRight: "auto",
              textAlign: "center",
            }}
          >
            {/* Eyebrow */}
            <p
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "var(--color-accent)",
                textTransform: "uppercase",
                letterSpacing: "0.10em",
                marginBottom: 20,
              }}
            >
              Self-Hosted &middot; Multi-Agent &middot; One-Time License
            </p>

            {/* Headline */}
            <h1
              style={{
                fontSize: "clamp(40px, 7vw, 68px)",
                fontWeight: 900,
                lineHeight: 1.05,
                letterSpacing: "-0.04em",
                color: "var(--color-text-primary)",
                marginBottom: 24,
              }}
            >
              Your AI agency,
              <br />
              <span style={{ color: "var(--color-accent)" }}>on your hardware.</span>
            </h1>

            {/* Sub-copy */}
            <p
              style={{
                fontSize: "clamp(17px, 2.5vw, 21px)",
                color: "var(--color-text-secondary)",
                lineHeight: 1.65,
                marginBottom: 40,
                maxWidth: 600,
                marginLeft: "auto",
                marginRight: "auto",
              }}
            >
              Chain reasoning agents with persistent memory, web search, and
              self&#8209;critique. Build multi-agent teams. Generate and edit video.
              All self-hosted in one Docker container with your own API keys &mdash;
              no subscription, no SaaS, no data leaving your machine.
            </p>

            {/* CTAs */}
            <div
              style={{
                display: "flex",
                gap: 12,
                justifyContent: "center",
                flexWrap: "wrap",
                marginBottom: 20,
              }}
            >
              <CTAButton href="/pricing" variant="primary" size="lg">
                Buy License &mdash; $79
              </CTAButton>
              <CTAButton href="/docs" variant="secondary" size="lg">
                Install Guide &rarr;
              </CTAButton>
            </div>

            {/* Trust line */}
            <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
              Launch price &mdash; goes to $99 after launch &middot; 14-day refund guarantee
            </p>
          </div>
        </Container>
      </section>

      {/* ── Stats bar ── */}
      <Section background="secondary">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 32,
            textAlign: "center",
          }}
        >
          {[
            { stat: "1 Container", label: "Full stack, Docker deploy" },
            { stat: "Multi-Agent", label: "Planner → Researcher → Executor" },
            { stat: "Real Memory", label: "Obsidian-compatible vault" },
            { stat: "$0 / mo", label: "No subscription ever" },
          ].map(({ stat, label }) => (
            <div key={label}>
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 800,
                  color: "var(--color-text-primary)",
                  letterSpacing: "-0.02em",
                  marginBottom: 4,
                }}
              >
                {stat}
              </div>
              <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>{label}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Agentic capabilities ── */}
      <Section>
        <SectionHeader
          title="An AI team that thinks, remembers, and creates"
          subtitle="Not just workflow automation — a full agentic reasoning platform with memory, search, and multi-agent collaboration."
        />
        <FeatureGrid>
          <FeatureCard
            icon={<AgentIcon />}
            title="ReAct Reasoning Agents"
            description="Agents that reason step-by-step, use tools, and iterate until they reach a correct answer. Not just prompt chaining — real thinking loops."
          />
          <FeatureCard
            icon={<TeamIcon />}
            title="Multi-Agent Teams"
            description="Build Planner → Researcher → Executor pipelines. Sub-agents inherit credentials from the parent and run with their own specialized roles."
          />
          <FeatureCard
            icon={<MemoryIcon />}
            title="Obsidian Memory Vault"
            description="Agents write and query a real Markdown knowledge base. Persistent across runs. Compatible with your existing Obsidian vault."
          />
          <FeatureCard
            icon={<SearchIcon />}
            title="Web Search Tool"
            description="Built-in DuckDuckGo and SerpAPI integration. Agents call web search as a tool — no extra setup, no API key required for the free tier."
          />
          <FeatureCard
            icon={<ReflectIcon />}
            title="Reflection & Self-Critique"
            description="After producing an answer, agents optionally run 1–3 self-critique rounds and improve their output. Ships better results, automatically."
          />
          <FeatureCard
            icon={<ApprovalIcon />}
            title="Human-in-the-Loop"
            description="Pause any agent before it finalizes an answer. Review, approve, or reject with feedback directly in the Run Debugger. No code required."
          />
        </FeatureGrid>
      </Section>

      {/* ── Creative output capabilities ── */}
      <Section background="secondary">
        <SectionHeader
          title="From reasoning to finished output"
          subtitle="Itera Studio isn't just an agent platform — it generates, edits, and exports professional creative assets."
        />
        <FeatureGrid>
          <FeatureCard
            icon={<CanvasIcon />}
            title="Visual Workflow Canvas"
            description="Drag-and-drop node editor built on React Flow. Connect agents, generation nodes, memory, and output steps into repeatable pipelines."
          />
          <FeatureCard
            icon={<VideoIcon />}
            title="Video Editor"
            description="Full timeline editor built in. Chain scenes, trim clips, arrange assets, and export — without leaving the studio."
          />
          <FeatureCard
            icon={<ModelsIcon />}
            title="Multi-Model Comparison"
            description="Run the same prompt across Stable Diffusion, Flux, DALL-E, and more in parallel. Compare results side-by-side, pick the best."
          />
          <FeatureCard
            icon={<CostIcon />}
            title="Cost Control"
            description="Per-run estimates, hard budget caps, and live usage dashboards. See exactly what each workflow costs before you run it."
          />
          <FeatureCard
            icon={<QueueIcon />}
            title="Redis Job Queue"
            description="BullMQ-powered queue handles retries, timeouts, and parallelism. Workflows survive container restarts. Schedule recurring runs."
          />
          <FeatureCard
            icon={<HistoryIcon />}
            title="Run History & Replay"
            description="Every run is versioned with its graph snapshot. Review past outputs, compare attempts, restore an exact run to edit and re-run."
          />
        </FeatureGrid>
      </Section>

      {/* ── How it works ── */}
      <Section>
        <SectionHeader
          title="Up and running in minutes"
          subtitle="From purchase to your first agentic workflow in under 10 minutes."
        />
        <div style={{ maxWidth: 600, marginLeft: "auto", marginRight: "auto" }}>
          <Steps
            items={[
              {
                title: "Buy a license",
                description:
                  "One-time purchase. You get an offline license key — an Ed25519 signed token that validates locally. No phone-home, no subscription lock.",
              },
              {
                title: "Run Docker",
                description:
                  "docker compose up — app + Redis spin up on your machine or server. No cloud account, no infrastructure setup.",
              },
              {
                title: "Set your password",
                description:
                  "First visit opens setup. Create a password — it stays on your machine, hashed with bcrypt. Done.",
              },
              {
                title: "Connect your AI providers",
                description:
                  "Add API keys for OpenAI, Anthropic, Replicate, Fal, or any supported provider. Keys are encrypted at rest with AES-256-GCM.",
              },
              {
                title: "Build your first agent workflow",
                description:
                  "Start from a template or build from scratch. Add a ReAct Agent, give it tools and memory, run it — watch it reason in real time in the debugger.",
              },
            ]}
          />
        </div>
      </Section>

      {/* ── Replaces this whole stack ── */}
      <Section background="secondary">
        <SectionHeader
          title="Replace your entire AI stack"
          subtitle="Itera Studio does the job of five fragmented SaaS tools — for a one-time fee, on your machine."
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 20,
            maxWidth: 900,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          {[
            {
              replaced: "LangFlow / n8n",
              cost: "$20–50 / mo",
              withItera: "Visual agentic workflows",
            },
            {
              replaced: "Relevance AI",
              cost: "$19–199 / mo",
              withItera: "ReAct agents + Sub-agents",
            },
            {
              replaced: "Mem.ai / Notion AI",
              cost: "$10–40 / mo",
              withItera: "Obsidian memory vault",
            },
            {
              replaced: "Descript / CapCut Pro",
              cost: "$12–24 / mo",
              withItera: "Built-in video editor",
            },
          ].map(({ replaced, cost, withItera }) => (
            <div
              key={replaced}
              style={{
                padding: 20,
                border: "1px solid var(--color-border)",
                borderRadius: 12,
                backgroundColor: "var(--color-surface)",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--color-text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 6,
                }}
              >
                Replaces
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: "var(--color-text-primary)",
                  marginBottom: 4,
                }}
              >
                {replaced}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "#f87171",
                  fontWeight: 600,
                  marginBottom: 10,
                }}
              >
                {cost}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--color-text-secondary)",
                  paddingTop: 10,
                  borderTop: "1px solid var(--color-border)",
                }}
              >
                <span style={{ color: "var(--color-accent)", fontWeight: 600 }}>
                  Itera Studio:{" "}
                </span>
                {withItera}
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            textAlign: "center",
            marginTop: 32,
            fontSize: 15,
            color: "var(--color-text-secondary)",
          }}
        >
          Combined cost of the above stack:{" "}
          <span style={{ color: "#f87171", fontWeight: 700 }}>$61–313 / month</span>
          &nbsp;&nbsp;vs.&nbsp;&nbsp;
          <span style={{ color: "var(--color-accent)", fontWeight: 700 }}>
            Itera Studio: $79 once.
          </span>
        </div>
      </Section>

      {/* ── Use cases ── */}
      <Section>
        <SectionHeader
          title="What you can build"
          subtitle="Itera Studio handles the orchestration — you define the goal, agents and tools do the rest."
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 20,
          }}
        >
          {[
            {
              title: "Research & Synthesis Agent",
              desc: "A ReAct agent searches the web, stores findings in a memory vault, reflects on gaps, and synthesizes a polished report — fully automated.",
            },
            {
              title: "Content Production Pipeline",
              desc: "From a brief to final video: generate scripts, create hero images across multiple models, pick the best, assemble in the video editor, export.",
            },
            {
              title: "Multi-Agent Analysis Teams",
              desc: "Planner delegates to Researcher and Critic sub-agents. Each runs with its own tools. Results are merged by the planner into a final deliverable.",
            },
            {
              title: "Iterative Image & Video",
              desc: "Run the same prompt across Stable Diffusion, Flux, and DALL-E in parallel. Compare, upscale the winner, add to timeline, export.",
            },
          ].map(({ title, desc }) => (
            <div
              key={title}
              style={{
                padding: 24,
                border: "1px solid var(--color-border)",
                borderRadius: 12,
                backgroundColor: "var(--color-surface)",
              }}
            >
              <h3
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: "var(--color-text-primary)",
                  marginBottom: 8,
                }}
              >
                {title}
              </h3>
              <p
                style={{
                  fontSize: 14,
                  color: "var(--color-text-secondary)",
                  lineHeight: 1.65,
                }}
              >
                {desc}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Privacy callout ── */}
      <Section background="secondary">
        <div style={{ maxWidth: 680, marginLeft: "auto", marginRight: "auto", textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 16 }}>🔒</div>
          <h2
            style={{
              fontSize: "clamp(24px, 4vw, 34px)",
              fontWeight: 800,
              color: "var(--color-text-primary)",
              letterSpacing: "-0.02em",
              marginBottom: 16,
            }}
          >
            Your data never leaves your machine
          </h2>
          <p
            style={{
              fontSize: 16,
              color: "var(--color-text-secondary)",
              lineHeight: 1.7,
              marginBottom: 28,
            }}
          >
            Everything is stored locally in SQLite inside your Docker volume.
            Provider API keys are encrypted with AES-256-GCM. The only outbound
            traffic is API calls you explicitly configure. No telemetry. No usage
            tracking. No account required after purchase.
          </p>
          <div
            style={{
              display: "flex",
              gap: 24,
              justifyContent: "center",
              flexWrap: "wrap",
              fontSize: 13,
              color: "var(--color-text-muted)",
            }}
          >
            {[
              "AES-256-GCM key encryption",
              "Offline license validation",
              "Zero telemetry",
              "bcrypt password hashing",
            ].map((item) => (
              <span key={item} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "var(--color-accent)" }}>✓</span>
                {item}
              </span>
            ))}
          </div>
        </div>
      </Section>

      {/* ── FAQ ── */}
      <Section>
        <SectionHeader title="Frequently asked questions" />
        <div style={{ maxWidth: 640, marginLeft: "auto", marginRight: "auto" }}>
          <FAQ
            items={[
              {
                question: "What makes this different from LangFlow or n8n?",
                answer:
                  "Itera Studio is purpose-built for agentic AI — not generic workflow automation. You get ReAct reasoning loops, sub-agent teams, a persistent Obsidian memory vault, built-in web search, self-critique, and a video editor, all in one visual canvas. LangFlow and n8n require assembling those capabilities from separate tools.",
              },
              {
                question: "Do I need a server to run it?",
                answer:
                  "Any machine that runs Docker works — your laptop, a home server, or a cloud VM. The app and Redis run in two lightweight containers. A 2-core, 2 GB RAM machine is sufficient for most workflows.",
              },
              {
                question: "What AI providers are supported?",
                answer:
                  "OpenAI, Anthropic, Replicate, Fal, and more at launch. The ReAct Agent and Sub-Agents work with any provider that supports a chat completion API. You bring your own keys and pay providers directly for what you use.",
              },
              {
                question: "Is this a subscription?",
                answer:
                  "No. You pay once and own the license. There are no recurring charges from Itera Studio. You only pay AI providers (OpenAI, Replicate, etc.) for the API calls your workflows make.",
              },
              {
                question: "What is the Obsidian memory vault?",
                answer:
                  "Agents can write to and search a real Markdown knowledge base stored on your disk. Notes persist across runs. The format is fully compatible with Obsidian, so you can open the same vault in your Obsidian app and browse agent-generated notes directly.",
              },
              {
                question: "Can multiple people use one instance?",
                answer:
                  "The Solo license is single-user. The Pro license supports up to 3 instances (useful for dev + staging + production). A Team license supporting up to 10 users with shared workflows and RBAC is launching Q3.",
              },
              {
                question: "What is the launch price and when does it change?",
                answer:
                  "The Solo license is $79 at launch — a limited early-adopter price that will increase to $99 after the launch window closes. Licenses purchased at $79 are grandfathered at that price forever.",
              },
              {
                question: "Do you offer refunds?",
                answer:
                  "Yes. If Itera Studio doesn't work for your use case, contact us within 14 days of purchase for a full refund — no questions asked.",
              },
            ]}
          />
        </div>
      </Section>

      {/* ── Final CTA ── */}
      <section
        style={{
          padding: "90px 0",
          textAlign: "center",
          background:
            "radial-gradient(ellipse at 50% 100%, rgba(59, 130, 246, 0.08) 0%, transparent 60%)",
        }}
      >
        <Container>
          <h2
            style={{
              fontSize: "clamp(28px, 4vw, 44px)",
              fontWeight: 900,
              color: "var(--color-text-primary)",
              letterSpacing: "-0.03em",
              marginBottom: 16,
            }}
          >
            Ship your first agentic workflow today.
          </h2>
          <p
            style={{
              fontSize: 17,
              color: "var(--color-text-secondary)",
              marginBottom: 36,
              maxWidth: 480,
              marginLeft: "auto",
              marginRight: "auto",
              lineHeight: 1.6,
            }}
          >
            One license. One Docker command. A full AI agency running on your hardware.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <CTAButton href="/pricing" variant="primary" size="lg">
              Buy License &mdash; $79
            </CTAButton>
            <CTAButton href="/docs" variant="secondary" size="lg">
              Read the Docs
            </CTAButton>
          </div>
          <p style={{ marginTop: 16, fontSize: 13, color: "var(--color-text-muted)" }}>
            Launch price &middot; 14-day refund guarantee &middot; No subscription ever
          </p>
        </Container>
      </section>
    </MarketingLayout>
  );
}

/* ── Inline Icons ── */

function AgentIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M6 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
      <path d="M18 8h2M4 8h2" />
    </svg>
  );
}

function TeamIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="7" r="3" />
      <path d="M3 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
      <circle cx="18" cy="7" r="3" />
      <path d="M21 20v-2a4 4 0 0 1-1-3" />
    </svg>
  );
}

function MemoryIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M4 10h16M4 14h10M4 18h6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function ReflectIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h18M3 6h18M3 18h12" />
      <path d="M18 15l3 3-3 3" />
    </svg>
  );
}

function ApprovalIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 12l2 2 4-4" />
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}

function CanvasIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M17.5 14v7M14 17.5h7" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="14" rx="2" />
      <path d="M7 6V4M12 6V4M17 6V4" />
      <path d="M10 12l4.5 2.5L10 17V12z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ModelsIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 3h5v5M8 3H3v5M16 21h5v-5M8 21H3v-5M12 8v8M8 12h8" />
    </svg>
  );
}

function CostIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 1 1 0 7H6" />
    </svg>
  );
}

function QueueIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20V10M18 20V4M6 20v-4" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}
