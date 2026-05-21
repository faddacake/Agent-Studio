import type { Metadata } from "next";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { Container } from "@/components/marketing/Container";
import { Section, SectionHeader } from "@/components/marketing/Section";
import { Steps } from "@/components/marketing/Steps";
import { CTAButton } from "@/components/marketing/CTAButton";

export const metadata: Metadata = {
  title: "License",
  description: "How Itera Studio licensing works: offline Ed25519 token validation, no subscriptions, no phone-home.",
};

export default function LicensePage() {
  return (
    <MarketingLayout>
      <section style={{ padding: "80px 0 40px" }}>
        <Container>
          <div style={{ maxWidth: 640, marginLeft: "auto", marginRight: "auto", textAlign: "center" }}>
            <h1 style={{ fontSize: "clamp(32px, 5vw, 48px)", fontWeight: 800, lineHeight: 1.15, letterSpacing: "-0.03em", color: "var(--color-text-primary)", marginBottom: 16 }}>
              How licensing works
            </h1>
            <p style={{ fontSize: 18, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
              Itera Studio uses offline license tokens. No accounts, no subscriptions, no phone-home.
            </p>
          </div>
        </Container>
      </section>

      <Section background="secondary">
        <SectionHeader title="The basics" />
        <div style={{ maxWidth: 600, marginLeft: "auto", marginRight: "auto" }}>
          <Steps items={[
            { title: "Purchase a license", description: "You buy a license key from the pricing page. It's a one-time purchase — no recurring fees." },
            { title: "Receive your key", description: "Your license key is a JWT (JSON Web Token) signed with Ed25519. It's delivered to your email after purchase." },
            { title: "Set the environment variable", description: "Add LICENSE_KEY=your-key to your .env file or Docker environment. That's the only setup needed." },
            { title: "Validation happens locally", description: "When Itera Studio starts, it verifies the Ed25519 signature using a public key bundled in the app. No internet required." },
          ]} />
        </div>
      </Section>

      <Section>
        <SectionHeader title="Technical details" />
        <div style={{ maxWidth: 640, marginLeft: "auto", marginRight: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
          <DetailCard title="Token format" description="License keys are Ed25519-signed JWTs containing: license tier (personal/team), maximum users, issue date, and optional expiry for time-limited offers." />
          <DetailCard title="Signature verification" description="The app embeds the Ed25519 public key. On startup, it verifies the JWT signature — if invalid or missing, the app shows a license error page. No network call is made." />
          <DetailCard title="Claims validated" description="The app checks: signature validity, expiry (if set), license tier, and max_users. If any check fails, protected routes are blocked." />
          <DetailCard title="No phone-home" description="There is zero outbound traffic for licensing. No usage reporting, no activation server, no heartbeat. The token is self-contained." />
          <DetailCard title="Updates" description="Your license covers the current major version. When a new major version releases, you can continue using your current version indefinitely, or purchase an upgrade key." />
          <DetailCard title="Transferability" description="You can move your license between machines. The key is not tied to hardware. The Personal license limits concurrent instances to one." />
        </div>
      </Section>

      <section style={{ padding: "60px 0", textAlign: "center" }}>
        <Container>
          <h2 style={{ fontSize: 28, fontWeight: 800, color: "var(--color-text-primary)", letterSpacing: "-0.02em", marginBottom: 16 }}>
            Ready to get started?
          </h2>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <CTAButton href="/pricing" variant="primary" size="lg">Buy License</CTAButton>
            <CTAButton href="/docs" variant="secondary" size="lg">Install Guide</CTAButton>
          </div>
        </Container>
      </section>
    </MarketingLayout>
  );
}

function DetailCard({ title, description }: { title: string; description: string }) {
  return (
    <div style={{ padding: 20, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 6 }}>{title}</h3>
      <p style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>{description}</p>
    </div>
  );
}
