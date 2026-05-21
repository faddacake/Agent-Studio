import Link from "next/link";
import { Container } from "./Container";

const FOOTER_LINKS = [
  {
    heading: "Product",
    links: [
      { label: "Features", href: "/features" },
      { label: "Pricing", href: "/pricing" },
      { label: "Docs", href: "/docs" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Security", href: "/security" },
      { label: "License", href: "/license" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
];

export function Footer() {
  return (
    <footer
      style={{
        borderTop: "1px solid var(--color-border)",
        backgroundColor: "var(--color-bg-secondary)",
        padding: "48px 0 32px",
      }}
    >
      <Container>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 32,
            marginBottom: 40,
          }}
        >
          <div>
            <span
              style={{
                fontWeight: 800,
                fontSize: 16,
                color: "var(--color-text-primary)",
                letterSpacing: "-0.02em",
              }}
            >
              Itera Studio
            </span>
            <p
              style={{
                fontSize: 13,
                color: "var(--color-text-muted)",
                marginTop: 8,
                lineHeight: 1.6,
              }}
            >
              Self-hosted AI workflow builder for creators and entrepreneurs.
            </p>
          </div>
          {FOOTER_LINKS.map((group) => (
            <div key={group.heading}>
              <h4
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                  marginBottom: 12,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {group.heading}
              </h4>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {group.links.map(({ label, href }) => (
                  <li key={href} style={{ marginBottom: 8 }}>
                    <Link
                      href={href}
                      style={{
                        fontSize: 14,
                        color: "var(--color-text-secondary)",
                        textDecoration: "none",
                        transition: "color 150ms ease",
                      }}
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div
          style={{
            borderTop: "1px solid var(--color-border)",
            paddingTop: 20,
            fontSize: 13,
            color: "var(--color-text-muted)",
          }}
        >
          &copy; {new Date().getFullYear()} Itera Studio. All rights reserved.
        </div>
      </Container>
    </footer>
  );
}
