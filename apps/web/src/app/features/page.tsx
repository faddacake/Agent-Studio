import type { Metadata } from "next";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { Section, SectionHeader } from "@/components/marketing/Section";
import { FeatureGrid, FeatureCard } from "@/components/marketing/FeatureGrid";
import { CTAButton } from "@/components/marketing/CTAButton";
import { Container } from "@/components/marketing/Container";

export const metadata: Metadata = {
  title: "Features",
  description:
    "Visual workflow canvas, multi-model comparison, cost controls, encrypted storage, and more. Everything you need to build AI content pipelines locally.",
};

export default function FeaturesPage() {
  return (
    <MarketingLayout>
      {/* Hero */}
      <section style={{ padding: "80px 0 40px" }}>
        <Container>
          <div style={{ maxWidth: 640, marginLeft: "auto", marginRight: "auto", textAlign: "center" }}>
            <h1
              style={{
                fontSize: "clamp(32px, 5vw, 48px)",
                fontWeight: 800,
                lineHeight: 1.15,
                letterSpacing: "-0.03em",
                color: "var(--color-text-primary)",
                marginBottom: 16,
              }}
            >
              Everything you need to build AI pipelines
            </h1>
            <p style={{ fontSize: 18, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
              Designed for creators and entrepreneurs who want speed, control, and privacy.
            </p>
          </div>
        </Container>
      </section>

      {/* Speed */}
      <Section background="secondary">
        <SectionHeader
          title="Speed"
          subtitle="Parallel execution with a Redis-backed job queue means nodes run as fast as your providers allow."
          align="left"
        />
        <FeatureGrid>
          <FeatureCard
            icon={<ZapIcon />}
            title="Parallel Node Execution"
            description="Independent nodes in your workflow run simultaneously. A 5-model comparison takes as long as the slowest model, not the sum of all five."
          />
          <FeatureCard
            icon={<QueueIcon />}
            title="Redis Job Queue"
            description="BullMQ-powered queue handles retries, timeouts, and concurrency limits. Jobs survive container restarts."
          />
          <FeatureCard
            icon={<TemplateIcon />}
            title="Start from Templates"
            description="Pre-built workflow templates for common tasks. Skip the setup, start generating immediately."
          />
        </FeatureGrid>
      </Section>

      {/* Quality */}
      <Section>
        <SectionHeader
          title="Quality"
          subtitle="Compare models, iterate on prompts, and pick the best output before committing budget."
          align="left"
        />
        <FeatureGrid>
          <FeatureCard
            icon={<CompareIcon />}
            title="Multi-Model Comparison"
            description="Run the same prompt through Stable Diffusion, Flux, DALL-E, and more. See results side-by-side in one view."
          />
          <FeatureCard
            icon={<PromptIcon />}
            title="One-Prompt Runner"
            description="Type a single prompt, select models, hit run. Get comparison results without building a full workflow."
          />
          <FeatureCard
            icon={<HistoryIcon />}
            title="Run History & Replay"
            description="Every run is versioned with its graph snapshot. Review past outputs, compare attempts, or re-run with tweaks."
          />
        </FeatureGrid>
      </Section>

      {/* Control */}
      <Section background="secondary">
        <SectionHeader
          title="Control"
          subtitle="Visual editing, manual overrides, and full run management — your pipeline, your rules."
          align="left"
        />
        <FeatureGrid>
          <FeatureCard
            icon={<CanvasIcon />}
            title="Visual Canvas Editor"
            description="Drag-and-drop node editor built on React Flow. Connect image generation, processing, and output nodes into pipelines."
          />
          <FeatureCard
            icon={<RunIcon />}
            title="Run Management"
            description="Start, pause, cancel, and resume runs. See per-node status, timing, and cost in real-time."
          />
          <FeatureCard
            icon={<OutputIcon />}
            title="Asset Export"
            description="Generated images, videos, and files stored locally. Download individually or export the full run output."
          />
        </FeatureGrid>
      </Section>

      {/* Cost */}
      <Section>
        <SectionHeader
          title="Cost"
          subtitle="Know what you'll spend before you run, and set hard limits to prevent overruns."
          align="left"
        />
        <FeatureGrid>
          <FeatureCard
            icon={<DollarIcon />}
            title="Per-Run Cost Estimates"
            description="See estimated cost before starting a run, based on model pricing and node configuration."
          />
          <FeatureCard
            icon={<ShieldIcon />}
            title="Budget Caps"
            description="Set hard or soft budget limits per run. Hard stop cancels remaining nodes; soft stop warns and continues."
          />
          <FeatureCard
            icon={<ChartIcon />}
            title="Usage Dashboard"
            description="Track spending across providers, models, and time periods. Identify which workflows cost the most."
          />
        </FeatureGrid>
      </Section>

      {/* Privacy */}
      <Section background="secondary">
        <SectionHeader
          title="Privacy & Security"
          subtitle="Self-hosted by design. Your data never touches our servers."
          align="left"
        />
        <FeatureGrid>
          <FeatureCard
            icon={<LockIcon />}
            title="Runs on Your Hardware"
            description="Deploy on your laptop, home server, or cloud VM. The only outbound traffic is API calls you explicitly configure."
          />
          <FeatureCard
            icon={<KeyIcon />}
            title="Encrypted Key Storage"
            description="Provider API keys encrypted with AES-256-GCM before writing to SQLite. Master key stays on your machine."
          />
          <FeatureCard
            icon={<OfflineIcon />}
            title="Offline License Validation"
            description="Ed25519 signed license tokens validate locally. No phone-home, no usage tracking, no telemetry."
          />
        </FeatureGrid>
      </Section>

      {/* CTA */}
      <section style={{ padding: "80px 0", textAlign: "center" }}>
        <Container>
          <h2
            style={{
              fontSize: "clamp(28px, 4vw, 36px)",
              fontWeight: 800,
              color: "var(--color-text-primary)",
              letterSpacing: "-0.02em",
              marginBottom: 16,
            }}
          >
            Ready to take control?
          </h2>
          <p style={{ fontSize: 17, color: "var(--color-text-secondary)", marginBottom: 32 }}>
            One license. Full access. No recurring fees.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <CTAButton href="/pricing" variant="primary" size="lg">Buy License</CTAButton>
            <CTAButton href="/docs" variant="secondary" size="lg">Install Guide</CTAButton>
          </div>
        </Container>
      </section>
    </MarketingLayout>
  );
}

/* ── Icons ── */
function ZapIcon() {
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>;
}
function QueueIcon() {
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M12 20V10M18 20V4M6 20v-4" /></svg>;
}
function TemplateIcon() {
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>;
}
function CompareIcon() {
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5M8 3H3v5M16 21h5v-5M8 21H3v-5M12 8v8M8 12h8" /></svg>;
}
function PromptIcon() {
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>;
}
function HistoryIcon() {
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>;
}
function CanvasIcon() {
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M17.5 14v7M14 17.5h7" /></svg>;
}
function RunIcon() {
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>;
}
function OutputIcon() {
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>;
}
function DollarIcon() {
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 1 1 0 7H6" /></svg>;
}
function ShieldIcon() {
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>;
}
function ChartIcon() {
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M18 20V10M12 20V4M6 20v-6" /></svg>;
}
function LockIcon() {
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>;
}
function KeyIcon() {
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" /></svg>;
}
function OfflineIcon() {
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>;
}
