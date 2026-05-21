"use client";

import { useEffect, useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch("/api/auth/check")
      .then((r) => r.json())
      .then((data) => {
        if (data.setupRequired) {
          window.location.href = "/setup";
        } else if (data.authenticated) {
          window.location.href = "/workflows";
        } else {
          setChecking(false);
        }
      })
      .catch(() => setChecking(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        window.location.href = "/workflows";
      } else {
        const data = await res.json();
        setError(data.message || "Invalid password");
      }
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  }

  if (checking) return null;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "var(--color-bg-primary)",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          padding: 32,
          borderRadius: 16,
          backgroundColor: "var(--color-surface)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: "var(--color-text-primary)",
              letterSpacing: "-0.02em",
              marginBottom: 6,
            }}
          >
            Agent Studio
          </h1>
          <p style={{ fontSize: 14, color: "var(--color-text-muted)" }}>
            Sign in to your local instance
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <label
            htmlFor="password"
            style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 6 }}
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            autoFocus
            required
            style={{
              width: "100%",
              padding: "11px 14px",
              borderRadius: 8,
              backgroundColor: "var(--color-bg-primary)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
              fontSize: 14,
              outline: "none",
              boxSizing: "border-box",
              marginBottom: 16,
            }}
          />

          {error && (
            <p
              role="alert"
              style={{ fontSize: 13, color: "var(--color-error)", marginBottom: 16 }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "11px 0",
              borderRadius: 8,
              backgroundColor: "var(--color-accent)",
              color: "#fff",
              border: "none",
              fontSize: 14,
              fontWeight: 600,
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <p style={{ textAlign: "center", marginTop: 20, fontSize: 12, color: "var(--color-text-muted)" }}>
          Single-user instance. No account needed.
        </p>
      </div>
    </div>
  );
}
