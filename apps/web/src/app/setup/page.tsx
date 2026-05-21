"use client";

import { useState } from "react";

export default function SetupPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        window.location.href = "/login";
      } else {
        const data = await res.json();
        setError(data.message || "Setup failed");
      }
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  }

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
            Welcome to Itera Studio
          </h1>
          <p style={{ fontSize: 14, color: "var(--color-text-muted)", lineHeight: 1.5 }}>
            Create a password to secure your local instance. This is the only account — there are no usernames or email signups.
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
            placeholder="Minimum 8 characters"
            autoFocus
            required
            minLength={8}
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

          <label
            htmlFor="confirm"
            style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 6 }}
          >
            Confirm password
          </label>
          <input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Re-enter password"
            required
            minLength={8}
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
            {loading ? "Setting up..." : "Create Password & Continue"}
          </button>
        </form>

        <div style={{ marginTop: 24, padding: 16, backgroundColor: "var(--color-bg-secondary)", borderRadius: 8, border: "1px solid var(--color-border)" }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6 }}>
            What happens next?
          </p>
          <ol style={{ fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.8, paddingLeft: 16, margin: 0 }}>
            <li>Sign in with your new password</li>
            <li>Go to Settings &rarr; Providers to add API keys</li>
            <li>Create your first workflow or use the One-Prompt runner</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
