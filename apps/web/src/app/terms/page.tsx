import type { Metadata } from "next";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { Container } from "@/components/marketing/Container";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Agent Studio terms of service for license purchase and software usage.",
};

export default function TermsPage() {
  return (
    <MarketingLayout>
      <section style={{ padding: "80px 0" }}>
        <Container>
          <div style={{ maxWidth: 640, marginLeft: "auto", marginRight: "auto" }}>
            <h1 style={{ fontSize: 36, fontWeight: 800, color: "var(--color-text-primary)", letterSpacing: "-0.02em", marginBottom: 8 }}>
              Terms of Service
            </h1>
            <p style={{ fontSize: 14, color: "var(--color-text-muted)", marginBottom: 40 }}>
              Last updated: February 2026
            </p>

            <LegalSection title="License grant">
              Upon purchase, you receive a non-exclusive, non-transferable license to use Agent Studio on one
              instance (Personal) or the number of seats specified (Team). The license is perpetual for the
              purchased major version.
            </LegalSection>

            <LegalSection title="Permitted use">
              You may install Agent Studio on any hardware you control — personal computers, private servers,
              or cloud VMs. You may use it for commercial and non-commercial purposes. You may not redistribute,
              sublicense, or resell the software or license keys.
            </LegalSection>

            <LegalSection title="AI provider usage">
              Agent Studio connects to third-party AI providers using API keys you supply. You are responsible
              for compliance with each provider&apos;s terms of service and any costs incurred through their APIs.
            </LegalSection>

            <LegalSection title="Refund policy">
              We offer a 14-day refund policy from the date of purchase. Contact support with your
              order details to request a refund.
            </LegalSection>

            <LegalSection title="Disclaimer">
              Agent Studio is provided &quot;as is&quot; without warranty of any kind. We are not responsible for
              costs incurred through AI provider APIs, generated content, or any damages arising from use
              of the software.
            </LegalSection>

            <LegalSection title="Updates">
              Your license includes free updates within the purchased major version. Major version upgrades
              may require a separate purchase. You may continue using any version you have a license for indefinitely.
            </LegalSection>

            <LegalSection title="Contact">
              For questions about these terms, contact us at legal@aistudio.example.com.
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
