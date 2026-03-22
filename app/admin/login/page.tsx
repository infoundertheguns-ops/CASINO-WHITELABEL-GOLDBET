"use client";

import { useState } from "react";

export default function AdminLoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setStatus("Autenticazione...");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: username, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Credenziali non valide");
        setLoading(false);
        setStatus("");
        return;
      }

      if (data.role !== "super_admin" && data.role !== "agent") {
        setError("Accesso non autorizzato. Solo admin e agenti.");
        setLoading(false);
        setStatus("");
        return;
      }

      setStatus("Accesso riuscito...");
      window.location.href = data.role === "super_admin" ? "/admin/dashboard" : "/admin/agents";
    } catch (err: any) {
      setError(err?.message || "Errore di connessione");
      setLoading(false);
      setStatus("");
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0914",
      }}
    >
      <div
        style={{
          width: 400,
          background: "#0f172a",
          border: "1px solid #1e3a5f",
          borderRadius: 16,
          padding: 40,
        }}
      >
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <span style={{ color: "#f0b429", fontSize: 32, fontWeight: 800 }}>VINCITU</span>
          <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>Back Office</div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 6, fontWeight: 600 }}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="username"
              required
              autoComplete="username"
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: 8,
                border: "1px solid #1e3a5f",
                background: "#0a0914",
                color: "#e2e8f0",
                fontSize: 15,
                outline: "none",
              }}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 6, fontWeight: 600 }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: 8,
                border: "1px solid #1e3a5f",
                background: "#0a0914",
                color: "#e2e8f0",
                fontSize: 15,
                outline: "none",
              }}
            />
          </div>

          {status && !error && (
            <div style={{
              padding: "10px 14px", borderRadius: 8, marginBottom: 12,
              background: "#3b82f615", border: "1px solid #3b82f640", color: "#60a5fa", fontSize: 13,
            }}>
              {status}
            </div>
          )}

          {error && (
            <div style={{
              padding: "10px 14px", borderRadius: 8, marginBottom: 12,
              background: "#ef444415", border: "1px solid #ef444440", color: "#ef4444", fontSize: 13,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "14px",
              borderRadius: 8,
              border: "none",
              background: loading ? "#f0b42960" : "#f0b429",
              color: "#000",
              fontSize: 15,
              fontWeight: 800,
              cursor: loading ? "not-allowed" : "pointer",
              transition: "background 0.15s",
            }}
          >
            {loading ? "Accesso..." : "Accedi"}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: 24, fontSize: 11, color: "#475569" }}>
          Admin · Super Agent · Master Agent · Agent · Sub-Agent
        </div>
      </div>
    </div>
  );
}
