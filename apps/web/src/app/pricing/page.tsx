import type { Metadata } from "next";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { Container } from "@/components/marketing/Container";
import { SectionHeader } from "@/components/marketing/Section";
import { PricingCard } from "@/components/marketing/PricingCard";
import { FAQ } from "@/components/marketing/FAQ";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "One-time license. All agentic features. No subscription. Run Agent Studio on your own hardware forever — Solo from $79, Pro from $149.",
};

export default function PricingPage() {
  const stripeEnabled = process.env.STRIPE_ENABLED === "true";

  return (
    <MarketingLayout>
      {/* ── Header ── */}
      <section style={{ padding: "80px 0 40px" }}>
        <Container>
          <SectionHeader
            title="Simple, one-time pricing"
            subtitle="Buy a license, install with Docker, own your AI agency platform forever. No subscriptions, no usage fees — you pay providers directly."
          />

          {/* Launch price banner */}
          <div
            style={{
              maxWidth: 560,
              marginLeft: "auto",
              marginRight: "auto",
              marginBottom: 32,
              padding: "12px 20px",
              borderRadius: 10,
              border: "1px solid rgba(251, 191, 36, 0.3)",
              backgroundColor: "rgba(251, 191, 36, 0.06)",
              textAlign: "center",
              fontSize: 14,
              color: "var(--color-text-secondary)",
            }}
          >
            <span style={{ color: "#fbbf24", fontWeight: 700 }}>⚡ Launch pricing</span>
            {" "}— Solo goes from $79 → $99 after launch.{" "}
            <span style={{ color: "var(--color-text-muted)" }}>
              Licenses purchased now are grandfathered at $79.
            </span>
          </div>

          {/* Pricing cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 24,
              maxWidth: 920,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            {/* Solo */}
            <PricingCard
              name="Solo"
              price="$79"
              period=""
              description="Single user, single instance. Every feature, no limits."
              highlighted
              badge="Launch Price"
              features={[
                "All agentic nodes — ReAct Agent, Sub-Agents, Memory, Web Search",
                "Reflection / self-critique",
                "Human-in-the-Loop approval gates",
                "Visual workflow canvas",
                "Video editor + video projects",
                "Multi-model comparison",
                "Budget caps & cost tracking",
                "Run history, replay & revisions",
                "Schedule recurring workflows",
                "Fragment & template system",
                "Encrypted key storage (AES-256-GCM)",
                "Lifetime updates (current major version)",
                "14-day refund guarantee",
              ]}
              ctaText={stripeEnabled ? "Buy Now — $79" : "Buy License — $79"}
              ctaHref={stripeEnabled ? "/api/billing/checkout?plan=solo" : "/docs"}
            />

            {/* Pro */}
            <PricingCard
              name="Pro"
              price="$149"
              period=""
              description="Up to 3 instances and 2 years of major-version updates."
              features={[
                "Everything in Solo",
                "Up to 3 simultaneous instances",
                "Extended version support — 2 years of major updates",
                "Priority email support",
                "Early access to new features",
              ]}
              ctaText={stripeEnabled ? "Buy Now — $149" : "Buy License — $149"}
              ctaHref={stripeEnabled ? "/api/billing/checkout?plan=pro" : "/docs"}
            />

            {/* Team */}
            <PricingCard
              name="Team"
              price="$299"
              period=""
              description="Up to 10 users with shared workflows and access controls. Launching Q3."
              features={[
                "Everything in Pro",
                "Up to 10 user accounts",
                "Shared workflow library",
                "Role-based access control",
                "Audit logs",
                "Dedicated support channel",
              ]}
              ctaText="Join Waitlist"
              ctaHref="/docs"
            />
          </div>
        </Container>
      </section>

      {/* ── What you get ── */}
      <section
        style={{
          padding: "60px 0",
          backgroundColor: "var(--color-bg-secondary)",
        }}
      >
        <Container>
          <div style={{ maxWidth: 680, marginLeft: "auto", marginRight: "auto" }}>
            <h2
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: "var(--color-text-primary)",
                marginBottom: 24,
                textAlign: "center",
              }}
            >
              What every license includes
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: 16,
              }}
            >
              {[
                {
                  label: "All agentic features",
                  detail:
                    "ReAct Agent, Sub-Agent Teams, Obsidian Memory, Web Search, Reflection, and Human-in-the-Loop are all included — no feature gating.",
                },
                {
                  label: "Offline license key",
                  detail:
                    "Ed25519 signed token — validates locally, no phone-home, no internet required after purchase.",
                },
                {
                  label: "Docker deployment",
                  detail:
                    "One compose file, two containers. Runs on your laptop, home server, or any cloud VM that supports Docker.",
                },
                {
                  label: "Lifetime updates",
                  detail:
                    "Free updates for the current major version. Pull the latest Docker image and restart — your data persists in the volume.",
                },
              ].map(({ label, detail }) => (
                <div
                  key={label}
                  style={{
                    padding: 16,
                    backgroundColor: "var(--color-surface)",
                    borderRadius: 10,
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <h3
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--color-text-primary)",
                      marginBottom: 6,
                    }}
                  >
                    {label}
                  </h3>
                  <p
                    style={{
                      fontSize: 13,
                      color: "var(--color-text-secondary)",
                      lineHeight: 1.55,
                    }}
                  >
                    {detail}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </section>

      {/* ── SaaS comparison ── */}
      <section style={{ padding: "60px 0" }}>
        <Container>
          <div style={{ maxWidth: 640, marginLeft: "auto", marginRight: "auto" }}>
            <h2
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: "var(--color-text-primary)",
                marginBottom: 8,
                textAlign: "center",
              }}
            >
              What you&apos;d pay for these features elsewhere
            </h2>
            <p
              style={{
                fontSize: 14,
                color: "var(--color-text-muted)",
                textAlign: "center",
                marginBottom: 24,
              }}
            >
              Monthly estimates for the equivalent SaaS stack
            </p>
            <div
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              {[
                { tool: "Relevance AI (agents + sub-agents)", price: "$19–199 / mo" },
                { tool: "n8n Cloud (workflow automation)", price: "$20–50 / mo" },
                { tool: "Mem.ai (persistent AI memory)", price: "$10–40 / mo" },
                { tool: "Descript / CapCut Pro (video editor)", price: "$12–24 / mo" },
              ].map(({ tool, price }, i) => (
                <div
                  key={tool}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "14px 20px",
                    backgroundColor:
                      i % 2 === 0 ? "var(--color-surface)" : "var(--color-bg-secondary)",
                    borderBottom: i < 3 ? "1px solid var(--color-border)" : "none",
                  }}
                >
                  <span style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
                    {tool}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#f87171" }}>{price}</span>
                </div>
              ))}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "16px 20px",
                  backgroundColor: "rgba(59, 130, 246, 0.06)",
                  borderTop: "2px solid var(--color-border)",
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>
                  Agent Studio Solo (all of the above)
                </span>
                <span style={{ fontSize: 16, fontWeight: 800, color: "var(--color-accent)" }}>
                  $79 once
                </span>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* ── FAQ ── */}
      <section
        style={{ padding: "60px 0", backgroundColor: "var(--color-bg-secondary)" }}
      >
        <Container>
          <div style={{ maxWidth: 640, marginLeft: "auto", marginRight: "auto" }}>
            <h2
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: "var(--color-text-primary)",
                marginBottom: 24,
                textAlign: "center",
              }}
            >
              Pricing FAQ
            </h2>
            <FAQ
              items={[
                {
                  question: "Is this a subscription?",
                  answer:
                    "No. You pay once and get a license key. There are no recurring charges from Agent Studio. You only pay AI providers (OpenAI, Anthropic, Replicate, etc.) directly for the API calls your workflows make.",
                },
                {
                  question: "What is the difference between Solo and Pro?",
                  answer:
                    "Solo allows one simultaneous instance on any machine. Pro allows up to 3 simultaneous instances — useful if you run Agent Studio on your laptop, a home server, and a production VM. Pro also extends version support to 2 years of major updates and includes priority support.",
                },
                {
                  question: "Are all agentic features included in the Solo license?",
                  answer:
                    "Yes — every feature is included in every license. There is no feature gating. ReAct Agents, Sub-Agent Teams, Obsidian Memory, Web Search, Reflection, Human-in-the-Loop, Video Editor, and everything else is fully available on the Solo license.",
                },
                {
                  question: "What happens after I buy?",
                  answer:
                    "You receive a LICENSE_KEY — an Ed25519 signed token. Add it to your Docker environment file, and the app validates it locally. No account or internet connection needed after setup.",
                },
                {
                  question: "Can I use it on multiple machines?",
                  answer:
                    "The Solo license allows one active instance at a time, but you can move it between machines freely. If you need to run multiple instances simultaneously, the Pro license covers up to 3.",
                },
                {
                  question: "What about updates?",
                  answer:
                    "Solo includes free updates for the current major version — pull the latest Docker image and restart. Pro extends this to 2 years of major updates. Your data persists in the Docker volume across updates.",
                },
                {
                  question: "When does the $79 launch price end?",
                  answer:
                    "The $79 Solo price is a limited launch window offer. It will increase to $99 once the window closes. We'll announce the change date on X and via email. Licenses purchased at $79 remain at that price forever.",
                },
                {
                  question: "Do you offer refunds?",
                  answer:
                    "Yes. If Agent Studio doesn't work for your use case, contact us within 14 days of purchase for a full refund — no questions asked.",
                },
              ]}
            />
          </div>
        </Container>
      </section>
    </MarketingLayout>
  );
}
