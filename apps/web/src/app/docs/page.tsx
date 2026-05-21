import type { Metadata } from "next";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { Container } from "@/components/marketing/Container";

export const metadata: Metadata = {
  title: "Documentation",
  description: "Install Itera Studio with Docker, set your license key, connect providers, and run your first workflow.",
};

export default function DocsPage() {
  return (
    <MarketingLayout>
      <section style={{ padding: "80px 0" }}>
        <Container>
          <div style={{ maxWidth: 720, marginLeft: "auto", marginRight: "auto" }}>
            <h1 style={{ fontSize: 36, fontWeight: 800, color: "var(--color-text-primary)", letterSpacing: "-0.02em", marginBottom: 8 }}>
              Documentation
            </h1>
            <p style={{ fontSize: 17, color: "var(--color-text-secondary)", marginBottom: 48, lineHeight: 1.6 }}>
              Get Itera Studio running in under 10 minutes.
            </p>

            <DocSection id="requirements" title="Requirements">
              <ul style={listStyle}>
                <li>Docker &amp; Docker Compose v2+</li>
                <li>At least 1 GB free RAM</li>
                <li>An API key for at least one AI provider (Replicate, Fal)</li>
                <li>A valid Itera Studio license key</li>
              </ul>
            </DocSection>

            <DocSection id="install" title="1. Install with Docker Compose">
              <p style={paraStyle}>Create a project directory and add the following <Code>docker-compose.yml</Code>:</p>
              <CodeBlock>{`services:
  app:
    image: ghcr.io/ai-studio/ai-studio:latest
    ports:
      - "\${APP_PORT:-3001}:3000"
    environment:
      - REDIS_URL=redis://redis:6379
      - DATA_DIR=/data
      - LICENSE_KEY=\${LICENSE_KEY}
    volumes:
      - app_data:/data
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped

volumes:
  app_data:
  redis_data:`}</CodeBlock>
            </DocSection>

            <DocSection id="license-key" title="2. Set your license key">
              <p style={paraStyle}>
                Create a <Code>.env</Code> file in the same directory as your <Code>docker-compose.yml</Code>:
              </p>
              <CodeBlock>{`# .env
LICENSE_KEY=eyJhbGciOiJFZERTQSIs...your-key-here
APP_PORT=3001`}</CodeBlock>
              <p style={paraStyle}>
                The license key is an Ed25519 signed JWT. It validates offline — no internet connection required after setup.
              </p>
            </DocSection>

            <DocSection id="start" title="3. Start Itera Studio">
              <CodeBlock>docker compose up -d</CodeBlock>
              <p style={paraStyle}>
                Wait for the health check to pass (about 30 seconds), then visit{" "}
                <Code>http://localhost:3001</Code>.
              </p>
            </DocSection>

            <DocSection id="setup" title="4. First-run setup">
              <p style={paraStyle}>
                On first visit you&apos;ll be redirected to <Code>/setup</Code>. Create a local password
                (minimum 8 characters). This password is hashed with bcrypt and stored in your local SQLite database.
                There are no user accounts — just a single password that protects your instance.
              </p>
            </DocSection>

            <DocSection id="providers" title="5. Connect AI providers">
              <p style={paraStyle}>
                After login, go to <strong>Settings → Providers</strong>. Add your API key for each provider:
              </p>
              <ul style={listStyle}>
                <li><strong>Replicate</strong> — image and video generation models (Flux, SDXL, etc.)</li>
                <li><strong>Fal</strong> — fast inference for image models</li>
              </ul>
              <p style={paraStyle}>
                Keys are encrypted with AES-256-GCM before being stored. The encryption key stays on your machine.
              </p>
            </DocSection>

            <DocSection id="first-workflow" title="6. Run your first workflow">
              <p style={paraStyle}>
                Go to <strong>Workflows → + New Workflow</strong>. You can either:
              </p>
              <ul style={listStyle}>
                <li>Start from a template (recommended for your first run)</li>
                <li>Use the One-Prompt runner at <Code>/prompt</Code> for quick multi-model comparisons</li>
                <li>Build a custom workflow on the visual canvas</li>
              </ul>
            </DocSection>

            <DocSection id="outputs" title="7. View outputs">
              <p style={paraStyle}>
                Generated assets (images, videos, files) are stored in the Docker volume at{" "}
                <Code>/data/assets/</Code>. View them in the run history or download directly.
              </p>
            </DocSection>

            <DocSection id="troubleshooting" title="Troubleshooting">
              <h4 style={h4Style}>Port already in use</h4>
              <p style={paraStyle}>
                Change <Code>APP_PORT</Code> in your <Code>.env</Code> file to a free port (e.g. <Code>APP_PORT=3002</Code>).
              </p>

              <h4 style={h4Style}>Redis connection failed</h4>
              <p style={paraStyle}>
                Ensure Redis is healthy: <Code>docker compose ps</Code>. If it&apos;s restarting, check logs with{" "}
                <Code>docker compose logs redis</Code>.
              </p>

              <h4 style={h4Style}>Permission denied on /data</h4>
              <p style={paraStyle}>
                The container runs as a non-root user. If you&apos;re mounting a host directory instead of a Docker volume,
                ensure the directory is writable by UID 1000.
              </p>

              <h4 style={h4Style}>License key invalid</h4>
              <p style={paraStyle}>
                Ensure the full JWT is in your <Code>.env</Code> file with no line breaks. Check that you copied
                the entire key including the <Code>eyJ</Code> prefix.
              </p>
            </DocSection>

            <DocSection id="environment" title="Environment variables reference">
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <th style={thStyle}>Variable</th>
                      <th style={thStyle}>Default</th>
                      <th style={thStyle}>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["APP_PORT", "3001", "Host port mapped to the container"],
                      ["LICENSE_KEY", "—", "Ed25519 signed JWT license token"],
                      ["REDIS_URL", "redis://redis:6379", "Redis connection URL"],
                      ["DATA_DIR", "/data", "SQLite DB, assets, config, backups"],
                      ["MASTER_KEY", "auto", "Hex encryption key (auto-generated if not set)"],
                      ["LOG_LEVEL", "info", "debug, info, warn, error"],
                      ["MAX_CONCURRENT_NODES", "5", "Max parallel prediction jobs"],
                      ["TRUST_PROXY", "false", "Read X-Forwarded-For behind a reverse proxy"],
                    ].map(([name, def, desc]) => (
                      <tr key={name} style={{ borderBottom: "1px solid var(--color-border)" }}>
                        <td style={tdStyle}><Code>{name}</Code></td>
                        <td style={tdStyle}><span style={{ color: "var(--color-text-muted)" }}>{def}</span></td>
                        <td style={tdStyle}>{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DocSection>
          </div>
        </Container>
      </section>
    </MarketingLayout>
  );
}

/* ── Shared styles ── */
const paraStyle: React.CSSProperties = {
  fontSize: 15,
  color: "var(--color-text-secondary)",
  lineHeight: 1.7,
  marginBottom: 12,
};
const listStyle: React.CSSProperties = {
  fontSize: 15,
  color: "var(--color-text-secondary)",
  lineHeight: 1.8,
  paddingLeft: 20,
  marginBottom: 12,
};
const h4Style: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: "var(--color-text-primary)",
  marginTop: 16,
  marginBottom: 4,
};
const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  color: "var(--color-text-primary)",
  fontWeight: 600,
};
const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  color: "var(--color-text-secondary)",
  verticalAlign: "top",
};

/* ── Helpers ── */
function DocSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ marginBottom: 48 }}>
      <h2
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: "var(--color-text-primary)",
          marginBottom: 16,
          paddingTop: 8,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      style={{
        backgroundColor: "var(--color-surface)",
        padding: "2px 6px",
        borderRadius: 4,
        fontSize: "0.9em",
        color: "var(--color-accent)",
      }}
    >
      {children}
    </code>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre
      style={{
        backgroundColor: "var(--color-bg-secondary)",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        padding: 16,
        overflowX: "auto",
        fontSize: 13,
        lineHeight: 1.6,
        color: "var(--color-text-primary)",
        fontFamily: "monospace",
        marginBottom: 16,
      }}
    >
      {children}
    </pre>
  );
}
