import type { Metadata } from "next";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { Container } from "@/components/marketing/Container";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Agent Studio privacy policy. Self-hosted software with zero data collection.",
};

export default function PrivacyPage() {
  return (
    <MarketingLayout>
      <section style={{ padding: "80px 0" }}>
        <Container>
          <div style={{ maxWidth: 640, marginLeft: "auto", marginRight: "auto" }}>
            <h1 style={{ fontSize: 36, fontWeight: 800, color: "var(--color-text-primary)", letterSpacing: "-0.02em", marginBottom: 8 }}>
              Privacy Policy
            </h1>
            <p style={{ fontSize: 14, color: "var(--color-text-muted)", marginBottom: 40 }}>
              Last updated: February 2026
            </p>

            <LegalSection title="Overview">
              Agent Studio is self-hosted software that runs entirely on your hardware. We do not operate
              any cloud service, do not collect usage data, and do not have access to your Agent Studio instance.
            </LegalSection>

            <LegalSection title="Data we collect">
              <strong>From the marketing website (this site):</strong> Standard web server logs (IP address,
              pages visited, browser info). No third-party analytics or tracking scripts.
              <br /><br />
              <strong>From the Agent Studio application:</strong> Nothing. The application runs on your
              infrastructure. We have no access to your workflows, API keys, generated assets, or any other data.
            </LegalSection>

            <LegalSection title="Purchase data">
              If you purchase a license through Stripe, Stripe processes your payment information under their
              privacy policy. We receive your email address and payment confirmation to deliver your license key.
              We do not store credit card details.
            </LegalSection>

            <LegalSection title="Third-party services">
              The Agent Studio application connects only to AI provider APIs (Replicate, Fal, etc.) that you
              explicitly configure. We have no control over how these providers handle data sent to their APIs.
              Review each provider&apos;s privacy policy before connecting.
            </LegalSection>

            <LegalSection title="Data retention">
              Marketing website logs are retained for 30 days. Purchase records (email, license key) are
              retained for the duration of your license for support purposes. You may request deletion at any time.
            </LegalSection>

            <LegalSection title="Contact">
              For privacy questions, contact us at privacy@aistudio.example.com.
            </LegalSection>
          </div>
        </Container>
      </section>
    </MarketingLayout>
  );
}

function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 12 }}>{title}</h2>
      <p style={{ fontSize: 15, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>{children}</p>
    </section>
  );
}
