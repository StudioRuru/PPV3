"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      window.location.href = "/";
    } else {
      const data = await res.json().catch(() => ({}));
      const retry = res.headers.get("Retry-After");
      setError(
        data.error || (retry ? `Too many attempts. Try again in ${retry}s.` : "Login failed"),
      );
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <form
        onSubmit={submit}
        className="bg-surface border-border w-full max-w-sm rounded-2xl border p-6"
      >
        <h1 className="text-xl font-semibold tracking-tight">NAI Studio</h1>
        <p className="text-muted mt-1 mb-5 text-sm">Enter your password to continue.</p>
        <input
          type="password"
          name="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          autoComplete="current-password"
          enterKeyHint="go"
          // 16px font avoids iOS Safari auto-zoom on focus.
          className="bg-bg border-border focus:border-accent w-full rounded-lg border px-3 py-3 text-base outline-none"
        />
        {error && <p className="text-danger mt-2 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="bg-accent text-accent-fg mt-4 w-full rounded-lg px-4 py-3 text-base font-medium disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
