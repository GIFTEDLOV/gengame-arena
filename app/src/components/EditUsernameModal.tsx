"use client";

import { useState } from "react";
import { updateUsername, getUserProfile } from "@/lib/genlayer";
import { friendlyError, type FriendlyError } from "@/lib/errorMessages";

async function pollForUpdatedUsername(
  address: string,
  expected: string,
  maxAttempts = 45,
  intervalMs = 2000
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const profile = await getUserProfile(address);
      if (profile && String(profile.username).toLowerCase() === expected.toLowerCase()) return true;
    } catch {
      // keep polling
    }
    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }
  return false;
}

interface Props {
  wallet: { address: string } | null;
  currentUsername: string;
  onSuccess: () => void;
  onClose: () => void;
}

export default function EditUsernameModal({ wallet, currentUsername, onSuccess, onClose }: Props) {
  const [username, setUsername] = useState("");
  const [error, setError] = useState<FriendlyError | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const isValid =
    username.length >= 3 &&
    username.length <= 20 &&
    /^[a-zA-Z0-9_]+$/.test(username) &&
    username.toLowerCase() !== currentUsername.toLowerCase();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValid) {
      if (username.toLowerCase() === currentUsername.toLowerCase()) {
        setError({ title: "Same username", message: "Enter a different username to update." });
      } else {
        setError({
          title: "Invalid username",
          message: "3–20 characters, letters, numbers, and underscores only.",
        });
      }
      return;
    }
    if (!wallet) {
      setError({ title: "No wallet", message: "No wallet found. Please sign in again." });
      return;
    }
    setLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await updateUsername(username, wallet as any);
      setStatusMessage("Confirming on-chain…");
      const ok = await pollForUpdatedUsername(wallet.address, username);
      if (ok) {
        onSuccess();
      } else {
        setError({
          title: "Still settling",
          message: "Update is on-chain but still finalizing. Close this and refresh in 30 seconds.",
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("taken")) {
        setError({ title: "Username taken", message: "Try a different username." });
      } else {
        setError(friendlyError(err));
      }
    } finally {
      setLoading(false);
      setStatusMessage("");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-sm rounded-xl p-6 flex flex-col gap-4"
        style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
            Update username
          </h2>
          <button
            onClick={onClose}
            className="text-sm"
            style={{ color: "var(--text-tertiary)" }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Current username:{" "}
          <span className="font-mono" style={{ color: "var(--accent-platform-hi, #a78bfa)" }}>
            @{currentUsername}
          </span>
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="New username"
            maxLength={20}
            disabled={loading}
            className="rounded-lg border px-4 py-3 text-sm focus:outline-none disabled:opacity-60"
            style={{
              background: "var(--surface-2, var(--bg-base))",
              borderColor: "var(--border)",
              color: "var(--text-primary)",
            }}
          />

          {error && (
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--danger, #f87171)" }}>
                {error.title}
              </p>
              <p className="text-sm mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                {error.message}
              </p>
              {error.cta && (
                <a
                  href={error.cta.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-sm underline"
                  style={{ color: "var(--accent-platform-hi, #a78bfa)" }}
                >
                  {error.cta.label} →
                </a>
              )}
            </div>
          )}

          {statusMessage && (
            <div className="flex items-center gap-2 py-1">
              <span
                className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-t-transparent"
                style={{ borderColor: "var(--accent-platform, #7c3aed)" }}
              />
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {statusMessage}
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !isValid}
            className="rounded-lg py-3 text-sm font-semibold transition-opacity disabled:opacity-50"
            style={{ background: "var(--accent-platform, #7c3aed)", color: "white" }}
          >
            {loading ? statusMessage || "Updating…" : "Update username"}
          </button>
        </form>
      </div>
    </div>
  );
}
