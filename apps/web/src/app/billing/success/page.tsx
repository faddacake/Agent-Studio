import type { Metadata } from "next";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { Container } from "@/components/marketing/Container";
import { CTAButton } from "@/components/marketing/CTAButton";
import { CopyBlock } from "./CopyBlock";

export const metadata: Metadata = {
  title: "Purchase Complete",
  description: "Your Itera Studio license purchase was successful. Follow these steps to get started.",
};

export default function BillingSuccessPage() {
  return (
    <MarketingLayout>
      <section style={{ padding: "80px 0" }}>
        <Container>
          <div style={{ maxWidth: 640, marginLeft: "auto", marginRight: "auto" }}>
            {/* Success header */}
            <div style={{ textAlign: "center", marginBottom: 48 }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  backgroundColor: "rgba(34, 197, 94, 0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 20px",
                }}
              >
                <svg width={28} height={28} viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 13l4 4L19 7"
                    stroke="var(--color-success)"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <h1
                style={{
                  fontSize: 32,
                  fontWeight: 800,
                  color: "var(--color-text-primary)",
                  letterSpacing: "-0.02em",
                  marginBottom: 12,
                }}
              >
                Purchase complete!
              </h1>
              <p style={{ fontSize: 16, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                Your license key will be delivered to your email shortly.
                Follow the steps below to get Itera Studio running.
              </p>
            </div>

            {/* Steps */}
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <StepCard step={1} title="Get your license key">
                <p style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.6, marginBottom: 12 }}>
                  Check your email for the license key. It looks like a long JWT token:
                </p>
                <CopyBlock code="eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJsaWNlbnNl..." />
              </StepCard>

              <StepCard step={2} title="Add it to your environment">
                <p style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.6, marginBottom: 12 }}>
                  Create a <code style={{ color: "var(--color-accent)" }}>.env</code> file next to your{" "}
                  <code style={{ color: "var(--color-accent)" }}>docker-compose.yml</code> and add:
                </p>
                <CopyBlock code="LICENSE_KEY=your-license-key-here" />
              </StepCard>

              <StepCard step={3} title="Start Itera Studio">
                <p style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.6, marginBottom: 12 }}>
                  Run the following command to start the app and Redis:
                </p>
                <CopyBlock code="docker compose up -d" />
              </StepCard>

              <StepCard step={4} title="Set your password and connect providers">
                <p style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                  Visit{" "}
                  <code style={{ color: "var(--color-accent)" }}>http://localhost:3001</code> to set
                  your local password, then go to Settings &rarr; Providers to add your API keys.
                </p>
              </StepCard>
            </div>

            {/* CTA */}
            <div style={{ textAlign: "center", marginTop: 48 }}>
              <CTAButton href="/docs" variant="secondary" size="lg">
                Full Installation Guide
              </CTAButton>
            </div>
          </div>
        </Container>
      </section>
    </MarketingLayout>
  );
}

function StepCard({
  step,
  title,
  children,
}: {
  step: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: 24,
        backgroundColor: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            backgroundColor: "var(--color-accent)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: 13,
            flexShrink: 0,
          }}
        >
          {step}
        </span>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--color-text-primary)" }}>{title}</h3>
      </div>
      {children}
    </div>
  );
}
