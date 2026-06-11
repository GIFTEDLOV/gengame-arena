"use client";
import { useState, type ReactNode } from "react";
import { useSettling } from "@/lib/settling";

interface TxButtonProps {
  onClick: () => Promise<void>;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
  pendingLabel?: string;
  description?: string;      // shown in the settling indicator tooltip
  onOptimistic?: () => void; // called immediately when clicked (before tx)
  onRevert?: () => void;     // called if the tx fails
}

export default function TxButton({
  onClick,
  disabled = false,
  className = "",
  children,
  pendingLabel = "Awaiting validator consensus…",
  description = "Transaction",
  onOptimistic,
  onRevert,
}: TxButtonProps) {
  const [status, setStatus] = useState<"idle" | "pending" | "done">("idle");
  const [error, setError] = useState("");
  const { addTx, removeTx } = useSettling();

  async function handle() {
    if (status === "pending") return;
    const txId = `tx-${Date.now()}-${Math.random()}`;
    setStatus("pending");
    setError("");
    onOptimistic?.();
    addTx(txId, description);
    try {
      await onClick();
      setStatus("done");
      removeTx(txId);
      setTimeout(() => setStatus("idle"), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("idle");
      onRevert?.();
      removeTx(txId);
    }
  }

  const isPending = status === "pending";
  const isDone = status === "done";

  return (
    <div>
      <button
        onClick={handle}
        disabled={disabled || isPending}
        className={className}
      >
        {isPending ? (
          <span className="flex items-center gap-2">
            <svg
              className="h-4 w-4 animate-spin"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            {pendingLabel}
          </span>
        ) : isDone ? (
          "✓ Done"
        ) : (
          children
        )}
      </button>
      {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
    </div>
  );
}
