"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Container } from "./Container";

const NAV_LINKS = [
  { label: "Features", href: "/features" },
  { label: "Pricing", href: "/pricing" },
  { label: "Docs", href: "/docs" },
  { label: "Security", href: "/security" },
];

export function Navbar() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        backgroundColor: "rgba(10, 10, 10, 0.85)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      <Container>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: 64,
          }}
        >
          {/* Logo */}
          <Link
            href="/"
            style={{
              fontWeight: 800,
              fontSize: 18,
              color: "var(--color-text-primary)",
              textDecoration: "none",
              letterSpacing: "-0.02em",
            }}
          >
            Itera Studio
          </Link>

          {/* Desktop nav */}
          <nav
            style={{
              display: "flex",
              alignItems: "center",
              gap: 32,
            }}
            className="nav-desktop"
          >
            {NAV_LINKS.map(({ label, href }) => (
              <Link
                key={href}
                href={href}
                style={{
                  fontSize: 14,
                  fontWeight: pathname === href ? 600 : 400,
                  color:
                    pathname === href
                      ? "var(--color-text-primary)"
                      : "var(--color-text-secondary)",
                  textDecoration: "none",
                  transition: "color 150ms ease",
                }}
              >
                {label}
              </Link>
            ))}
            <Link
              href="/prompt"
              style={{
                fontSize: 14,
                fontWeight: 600,
                padding: "8px 18px",
                borderRadius: 8,
                backgroundColor: "transparent",
                color: "var(--color-accent)",
                textDecoration: "none",
                border: "1px solid var(--color-accent)",
              }}
            >
              Launch Studio
            </Link>
            <Link
              href="/pricing"
              style={{
                fontSize: 14,
                fontWeight: 600,
                padding: "8px 18px",
                borderRadius: 8,
                backgroundColor: "var(--color-accent)",
                color: "#fff",
                textDecoration: "none",
              }}
            >
              Buy License
            </Link>
          </nav>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="nav-mobile-toggle"
            aria-label="Toggle menu"
            style={{
              display: "none",
              background: "none",
              border: "none",
              color: "var(--color-text-primary)",
              cursor: "pointer",
              padding: 4,
            }}
          >
            <svg width={24} height={24} viewBox="0 0 24 24" fill="none">
              {menuOpen ? (
                <path
                  d="M6 6L18 18M6 18L18 6"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d="M4 6h16M4 12h16M4 18h16"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <nav
            className="nav-mobile-menu"
            style={{
              display: "none",
              flexDirection: "column",
              gap: 4,
              paddingBottom: 16,
            }}
          >
            {NAV_LINKS.map(({ label, href }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                style={{
                  fontSize: 15,
                  fontWeight: pathname === href ? 600 : 400,
                  color:
                    pathname === href
                      ? "var(--color-text-primary)"
                      : "var(--color-text-secondary)",
                  textDecoration: "none",
                  padding: "12px 0",
                  borderBottom: "1px solid var(--color-border)",
                }}
              >
                {label}
              </Link>
            ))}
            <Link
              href="/prompt"
              onClick={() => setMenuOpen(false)}
              style={{
                fontSize: 15,
                fontWeight: 600,
                padding: "12px 18px",
                borderRadius: 8,
                backgroundColor: "transparent",
                color: "var(--color-accent)",
                textDecoration: "none",
                textAlign: "center",
                marginTop: 8,
                border: "1px solid var(--color-accent)",
              }}
            >
              Launch Studio
            </Link>
            <Link
              href="/pricing"
              onClick={() => setMenuOpen(false)}
              style={{
                fontSize: 15,
                fontWeight: 600,
                padding: "12px 18px",
                borderRadius: 8,
                backgroundColor: "var(--color-accent)",
                color: "#fff",
                textDecoration: "none",
                textAlign: "center",
                marginTop: 8,
              }}
            >
              Buy License
            </Link>
          </nav>
        )}
      </Container>
    </header>
  );
}
