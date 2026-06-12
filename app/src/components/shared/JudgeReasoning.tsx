"use client";

export type JudgeGame = "prompt-wars" | "predictions" | "trivia" | "title-wars";

const GAME_ACCENT: Record<JudgeGame, string> = {
  "prompt-wars": "var(--game-prompt-wars)",
  predictions:   "var(--game-predictions)",
  trivia:        "var(--game-trivia)",
  "title-wars":  "var(--game-title-wars)",
};

const GAME_FONT: Record<JudgeGame, string> = {
  "prompt-wars": "var(--font-serif)",
  predictions:   "var(--font-mono)",
  trivia:        "var(--font-display)",
  "title-wars":  "var(--font-serif)",
};

function ConsensusIcon({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="9" cy="3.5" r="2.2" fill={color} />
      <circle cx="3.5" cy="14" r="2.2" fill={color} opacity="0.75" />
      <circle cx="14.5" cy="14" r="2.2" fill={color} opacity="0.75" />
      <line x1="9" y1="5.7" x2="4.5" y2="11.8" stroke={color} strokeWidth="1.2" opacity="0.5" />
      <line x1="9" y1="5.7" x2="13.5" y2="11.8" stroke={color} strokeWidth="1.2" opacity="0.5" />
      <line x1="5.7" y1="14" x2="12.3" y2="14" stroke={color} strokeWidth="1.2" opacity="0.5" />
    </svg>
  );
}

export default function JudgeReasoning({
  reasoning,
  game,
  verdict,
  sourceUrl,
}: {
  reasoning: string;
  game: JudgeGame;
  verdict?: string;
  sourceUrl?: string;
}) {
  const accent = GAME_ACCENT[game];
  const fontFamily = GAME_FONT[game];

  return (
    <div
      className="rounded-xl border p-5 space-y-3"
      style={{
        borderColor: `color-mix(in srgb, ${accent} 28%, transparent)`,
        background: `color-mix(in srgb, ${accent} 5%, var(--bg-elevated))`,
      }}
    >
      <div className="flex items-center gap-2">
        <ConsensusIcon color={accent} />
        <span
          className="text-xs font-semibold uppercase tracking-widest"
          style={{ color: accent }}
        >
          Judge&apos;s Decision
        </span>
      </div>

      {verdict && (
        <p
          className="text-xl font-bold leading-tight"
          style={{ color: accent, fontFamily }}
        >
          {verdict}
        </p>
      )}

      <p
        className="text-sm leading-relaxed"
        style={{ color: "var(--text-secondary)", fontFamily }}
      >
        {reasoning}
      </p>

      {sourceUrl && (
        <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
          Source:{" "}
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline transition-opacity hover:opacity-80"
            style={{ color: accent }}
          >
            {sourceUrl.length > 70 ? sourceUrl.slice(0, 70) + "…" : sourceUrl}
          </a>
        </p>
      )}

      <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
        Decided by GenLayer validator consensus ·{" "}
        <a
          href="https://docs.genlayer.com/equivalence-principle"
          target="_blank"
          rel="noopener noreferrer"
          className="underline opacity-60 hover:opacity-100 transition-opacity"
        >
          learn more
        </a>
      </p>
    </div>
  );
}
