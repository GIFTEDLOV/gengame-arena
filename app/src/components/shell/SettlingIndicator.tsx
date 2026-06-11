"use client";
import { useState } from "react";
import { useSettling } from "@/lib/settling";

export default function SettlingIndicator() {
  const { txs } = useSettling();
  const [hovered, setHovered] = useState(false);

  if (txs.length === 0) return null;

  return (
    <div className="relative">
      <div
        className="flex items-center gap-2 rounded-pill px-3 py-1.5 cursor-default select-none"
        style={{
          backgroundColor: "rgba(139, 92, 246, 0.12)",
          border: "1px solid rgba(139, 92, 246, 0.25)",
          borderRadius: "var(--radius-pill)",
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <span
          className="animate-pulse-dot h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: "var(--accent-platform-hi)" }}
        />
        <span
          className="text-xs font-medium"
          style={{ color: "var(--accent-platform-hi)" }}
        >
          {txs.length} settling
        </span>
      </div>

      {hovered && txs.length > 0 && (
        <div
          className="absolute right-0 top-full mt-2 min-w-[200px] rounded-md border p-3 z-50"
          style={{
            backgroundColor: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-card)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <p
            className="mb-2 text-xs font-semibold"
            style={{ color: "var(--text-secondary)" }}
          >
            Settling on-chain
          </p>
          <ul className="space-y-1">
            {txs.map((tx) => (
              <li
                key={tx.id}
                className="flex items-center gap-2 text-xs"
                style={{ color: "var(--text-tertiary)" }}
              >
                <span
                  className="animate-pulse-dot h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: "var(--accent-platform)" }}
                />
                {tx.description}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
