"use client";

import { useState, useEffect } from "react";
import { registerUser, getUserProfile } from "@/lib/genlayer";
import { friendlyError, type FriendlyError } from "@/lib/errorMessages";

const FAUCET_URL = "https://testnet-faucet.genlayer.foundation";
const RPC_URL = process.env.NEXT_PUBLIC_GENLAYER_RPC ?? "https://rpc-bradbury.genlayer.com";

async function pollForProfile(
  address: string,
  maxAttempts = 45,
  intervalMs = 2000
): Promise<{ username: string } | null> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const profile = await getUserProfile(address);
      if (profile && profile.username) return { username: String(profile.username) };
    } catch {
      // keep polling
    }
    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }
  return null;
}

interface Props {
  wallet: { address: string } | null;
  onSuccess: (username: string) => void;
  onClose: () => void;
}

export default function RegisterModal({ wallet, onSuccess, onClose }: Props) {
  const [username, setUsername] = useState("");
  const [error, setError] = useState<FriendlyError | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [txStartTime, setTxStartTime] = useState<number | null>(null);

  useEffect(() => {
    if (!loading || !txStartTime) return;
    const update = () => {
      const s = (Date.now() - txStartTime) / 1000;
      if (s < 5) setStatusMessage("Submitting registration…");
      else if (s < 30) setStatusMessage("GenLayer validators are processing your registration…");
      else if (s < 90) setStatusMessage("Almost done — validators reaching consensus…");
      else setStatusMessage("Still working — Bradbury testnet is occasionally slow.");
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [loading, txStartTime]);

  useEffect(() => {
    if (!wallet?.address) return;
    fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_getBalance",
        params: [wallet.address, "latest"],
        id: 1,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        setBalance(data.result ? BigInt(data.result) : BigInt(0));
      })
      .catch(() => setBalance(BigInt(0)));
  }, [wallet?.address]);

  const hasBalance = balance !== null && balance > BigInt(0);
  const balanceGEN = balance !== null ? (Number(balance) / 1e18).toFixed(1) : null;
  const isValid =
    username.length >= 3 &&
    username.length <= 20 &&
    /^[a-zA-Z0-9_]+$/.test(username);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValid) {
      setError({
        title: "Invalid username",
        message: "3–20 characters, letters, numbers, and underscores only.",
      });
      return;
    }
    if (!wallet) {
      setError({ title: "No wallet", message: "No wallet found. Please sign in again." });
      return;
    }
    setLoading(true);
    setTxStartTime(Date.now());
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await registerUser(username, wallet as any);
      setStatusMessage("Finalizing on-chain…");
      const profile = await pollForProfile(wallet.address);
      if (profile) {
        onSuccess(profile.username);
      } else {
        setError({
          title: "Still settling",
          message:
            "Your registration is on-chain but still finalizing. Close this and try the action again in 30 seconds.",
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
      setTxStartTime(null);
      setStatusMessage("");
    }
  }

  function openFaucet() {
    if (wallet?.address) {
      navigator.clipboard.writeText(wallet.address).catch(() => {});
    }
    window.open(FAUCET_URL, "_blank", "noopener,noreferrer");
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
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
            Set a username (optional)
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
          Pick a name that appears next to your matches on leaderboards. Optional — you can play anonymously.
        </p>

        {/* Balance row */}
        {balance !== null && (
          <div
            className="rounded-lg px-3 py-2 text-sm"
            style={{
              background: hasBalance
                ? "color-mix(in srgb, var(--accent-platform) 10%, transparent)"
                : "rgba(251,191,36,0.08)",
              border: hasBalance
                ? "1px solid color-mix(in srgb, var(--accent-platform) 25%, transparent)"
                : "1px solid rgba(251,191,36,0.25)",
              color: hasBalance ? "var(--text-secondary)" : "#fbbf24",
            }}
          >
            {hasBalance ? (
              <span>Balance: {balanceGEN} GEN ✓</span>
            ) : (
              <span>
                Balance: 0 GEN —{" "}
                <button
                  onClick={openFaucet}
                  className="underline font-medium"
                  style={{ color: "#fbbf24", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  Get testnet GEN
                </button>{" "}
                (your address will be copied)
              </span>
            )}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. prompt_wizard"
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
            disabled={loading || !isValid || !hasBalance}
            className="rounded-lg py-3 text-sm font-semibold transition-opacity disabled:opacity-50"
            style={{ background: "var(--accent-platform, #7c3aed)", color: "white" }}
          >
            {loading ? statusMessage || "Registering…" : "Register & continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
