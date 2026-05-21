import type { Metadata } from "next";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { Container } from "@/components/marketing/Container";
import { Section, SectionHeader } from "@/components/marketing/Section";
import { FeatureGrid, FeatureCard } from "@/components/marketing/FeatureGrid";

export const metadata: Metadata = {
  title: "Security",
  description: "How Agent Studio protects your data: local-first architecture, AES-256-GCM encryption, offline license validation, and zero telemetry.",
};

export default function SecurityPage() {
  return (
    <MarketingLayout>
      <section style={{ padding: "80px 0 40px" }}>
        <Container>
          <div style={{ maxWidth: 640, marginLeft: "auto", marginRight: "auto", textAlign: "center" }}>
            <h1 style={{ fontSize: "clamp(32px, 5vw, 48px)", fontWeight: 800, lineHeight: 1.15, letterSpacing: "-0.03em", color: "var(--color-text-primary)", marginBottom: 16 }}>
              Security by design
            </h1>
            <p style={{ fontSize: 18, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
              Agent Studio runs on your hardware. Your data never touches our servers. Here&apos;s how we keep it safe.
            </p>
          </div>
        </Container>
      </section>

      <Section background="secondary">
        <SectionHeader title="Architecture" subtitle="Local-first means your data stays local." />
        <FeatureGrid>
          <FeatureCard
            icon={<ServerIcon />}
            title="Self-Hosted Only"
            description="Agent Studio runs entirely inside your Docker environment. There is no cloud service, no hosted option, and no data collection. The only network traffic is API calls you configure to AI providers."
          />
          <FeatureCard
            icon={<DbIcon />}
            title="SQLite on Disk"
            description="All application data — workflows, run history, settings — is stored in a local SQLite database inside your Docker volume. No external database service required."
          />
          <FeatureCard
            icon={<LockIcon />}
            title="No Telemetry"
            description="Zero analytics, zero usage tracking, zero phone-home. The app does not contact any external server for functionality. License validation is offline."
          />
        </FeatureGrid>
      </Section>

      <Section>
        <SectionHeader title="Encryption" subtitle="API keys and sensitive data are encrypted at rest." />
        <div style={{ maxWidth: 640, marginLeft: "auto", marginRight: "auto" }}>
          <InfoBlock title="API Key Encryption">
            Provider API keys are encrypted using <strong>AES-256-GCM</strong> before being written to the database.
            Each key gets a unique initialization vector (IV) and authentication tag. The encryption uses PBKDF2 with
            100,000 iterations for key derivation from your master key.
          </InfoBlock>
          <InfoBlock title="Master Key">
            The master encryption key is either set via the <code style={{ color: "var(--color-accent)" }}>MASTER_KEY</code> environment variable (64-character hex string = 32 bytes)
            or auto-generated and saved to <code style={{ color: "var(--color-accent)" }}>/data/config/master.key</code> with file permissions <code style={{ color: "var(--color-accent)" }}>0600</code>.
            It never leaves your machine.
          </InfoBlock>
          <InfoBlock title="Password Hashing">
            Your login password is hashed with <strong>bcrypt</strong> (cost factor 12) and stored in the settings table.
            The plaintext password is never stored or logged.
          </InfoBlock>
          <InfoBlock title="Session Tokens">
            Authentication uses <strong>HS256 JWT tokens</strong> signed with the master key. Tokens expire after 7 days.
            Sessions are HTTP-only, secure (in production), and SameSite=strict cookies.
          </InfoBlock>
        </div>
      </Section>

      <Section background="secondary">
        <SectionHeader title="Threat model" subtitle="What Agent Studio protects against — and what it doesn't." />
        <div style={{ maxWidth: 640, marginLeft: "auto", marginRight: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--color-success)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Protected
              </h3>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 2 }}>
                <li>API keys leaked from database dump</li>
                <li>Unauthorized access without password</li>
                <li>Session hijacking (HttpOnly + Secure)</li>
                <li>Data exfiltration to third parties</li>
                <li>Brute-force login (rate limiting)</li>
              </ul>
            </div>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-muted)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Out of Scope
              </h3>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 14, color: "var(--color-text-muted)", lineHeight: 2 }}>
                <li>Host OS compromise</li>
                <li>Physical access to the machine</li>
                <li>Network MITM (use HTTPS proxy)</li>
                <li>Malicious Docker images</li>
                <li>Provider-side data handling</li>
              </ul>
            </div>
          </div>
        </div>
      </Section>

      <Section>
        <SectionHeader title="Best practices" />
        <div style={{ maxWidth: 640, marginLeft: "auto", marginRight: "auto" }}>
          <ul style={{ fontSize: 15, color: "var(--color-text-secondary)", lineHeight: 2, paddingLeft: 20 }}>
            <li>Run behind a reverse proxy (Caddy, Nginx) with HTTPS for production use</li>
            <li>Set <code style={{ color: "var(--color-accent)" }}>TRUST_PROXY=true</code> if behind a proxy, so rate limiting uses the real client IP</li>
            <li>Use <code style={{ color: "var(--color-accent)" }}>ALLOWED_IPS</code> to restrict access to trusted networks</li>
            <li>Back up your <code style={{ color: "var(--color-accent)" }}>/data</code> volume regularly — it contains your database, assets, and master key</li>
            <li>Use a strong password (12+ characters) for the login</li>
            <li>Set <code style={{ color: "var(--color-accent)" }}>MASTER_KEY</code> explicitly in production so it persists across container rebuilds</li>
          </ul>
        </div>
      </Section>
    </MarketingLayout>
  );
}

function InfoBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 20, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, marginBottom: 16 }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 8 }}>{title}</h3>
      <p style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>{children}</p>
    </div>
  );
}

function ServerIcon() { return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" /><rect x="2" y="14" width="20" height="8" rx="2" /><circle cx="6" cy="6" r="1" fill="currentColor" /><circle cx="6" cy="18" r="1" fill="currentColor" /></svg>; }
function DbIcon() { return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>; }
function LockIcon() { return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>; }
