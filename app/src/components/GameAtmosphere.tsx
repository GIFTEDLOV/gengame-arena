"use client";

import React from "react";

export type GameKey = "prompt-wars" | "predictions" | "trivia-royale" | "title-wars";

const FIXED: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  pointerEvents: "none",
  zIndex: 0,
};

/* ── Prompt Wars — writing desk in a sunlit library ─────── */
const PW_LETTERS = ["A", "Z", "Q", "J", "X", "W", "B", "P", "N", "T"];
const PW_PTS     = [10,   8,   8,   8,   8,   4,   3,   3,   1,   1];

function PromptWarsAtmosphere() {
  return (
    <>
      {/* Layer 1: warm amber-brown radial from top-left */}
      <div
        style={{
          ...FIXED,
          background:
            "radial-gradient(ellipse 80% 65% at 0% 0%, oklch(38% 0.09 74) 0%, var(--bg-base) 62%)",
        }}
      />

      {/* Layer 2: drifting letter-tile SVG motif */}
      <svg
        className="animate-atm-pw-drift"
        style={{ ...FIXED, overflow: "hidden", opacity: 0.18 }}
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            id="atm-pw-tiles"
            x="0"
            y="0"
            width="400"
            height="160"
            patternUnits="userSpaceOnUse"
          >
            {PW_LETTERS.map((letter, i) => {
              const col = i % 5;
              const row = Math.floor(i / 5);
              const x   = col * 80;
              const y   = row * 80;
              return (
                <g key={letter}>
                  <rect
                    x={x + 6} y={y + 6} width={68} height={68} rx={9}
                    fill="rgba(251,191,36,0.10)"
                    stroke="rgba(251,191,36,0.15)"
                    strokeWidth={1}
                  />
                  <text
                    x={x + 40} y={y + 50}
                    textAnchor="middle"
                    fontFamily="Georgia, serif"
                    fontSize={30}
                    fill="rgba(251,191,36,0.55)"
                  >
                    {letter}
                  </text>
                  <text
                    x={x + 63} y={y + 67}
                    fontFamily="monospace"
                    fontSize={9}
                    fill="rgba(251,191,36,0.35)"
                  >
                    {PW_PTS[i]}
                  </text>
                </g>
              );
            })}
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#atm-pw-tiles)" />
      </svg>

      {/* Layer 3: warm amber ambient glow — top-left corner */}
      <div
        style={{
          ...FIXED,
          background:
            "radial-gradient(ellipse 42vw 42vw at 0% 0%, oklch(72% 0.13 75) 0%, transparent 70%)",
          opacity: 0.22,
        }}
      />
    </>
  );
}

/* ── Predictions — trader's desk at dusk ───────────────────── */
const SPK_X = [0, 120, 240, 360, 480, 600, 720, 840, 960, 1080, 1200];
const SPK_Y = [55,  38,  62,  28,  52,  18,  44,  32,  58,   22,   48];
const sparkPoints = SPK_X.map((x, i) => `${x},${SPK_Y[i]}`).join(" ");

function PredictionsAtmosphere() {
  return (
    <>
      {/* Layer 1: deep teal-black gradient top → bg-base */}
      <div
        style={{
          ...FIXED,
          background:
            "linear-gradient(to bottom, oklch(19% 0.055 200) 0%, var(--bg-base) 55%)",
        }}
      />

      {/* Layer 2a: fine vertical gridlines */}
      <div
        style={{
          ...FIXED,
          backgroundImage:
            "repeating-linear-gradient(90deg, rgba(45,212,191,0.05) 0px, rgba(45,212,191,0.05) 1px, transparent 1px, transparent 80px)",
        }}
      />

      {/* Layer 2b: sparkline path — redraws left→right over 25s */}
      <svg
        aria-hidden="true"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          top: "28%",
          width: "100%",
          height: "8vh",
          pointerEvents: "none",
          zIndex: 0,
          overflow: "visible",
        }}
        viewBox="0 0 1200 100"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <polyline
          className="animate-atm-pred-sparkline"
          points={sparkPoints}
          fill="none"
          stroke="rgba(45,212,191,0.22)"
          strokeWidth={1.5}
          strokeDasharray="1800"
          strokeDashoffset="1800"
          pathLength="1800"
        />
        {SPK_X.map((x, i) => (
          <circle key={x} cx={x} cy={SPK_Y[i]} r={2.5} fill="rgba(45,212,191,0.22)" />
        ))}
      </svg>

      {/* Layer 3: cool teal ambient glow — top-right corner */}
      <div
        style={{
          ...FIXED,
          background:
            "radial-gradient(ellipse 38vw 38vw at 100% 0%, oklch(62% 0.16 195) 0%, transparent 70%)",
          opacity: 0.20,
        }}
      />
    </>
  );
}

/* ── Trivia Royale — game show stage, low light ─────────── */
const TRIVIA_RINGS = [
  { sizeVw: 18, delay: "0s",   opacity: 0.25 },
  { sizeVw: 32, delay: "1.2s", opacity: 0.20 },
  { sizeVw: 46, delay: "2.4s", opacity: 0.16 },
  { sizeVw: 60, delay: "3.6s", opacity: 0.12 },
  { sizeVw: 74, delay: "4.8s", opacity: 0.09 },
  { sizeVw: 88, delay: "6.0s", opacity: 0.07 },
];

function TriviaAtmosphere() {
  return (
    <>
      {/* Layer 1: deep magenta-black radial from bottom-center */}
      <div
        style={{
          ...FIXED,
          background:
            "radial-gradient(ellipse 80% 55% at 50% 100%, oklch(24% 0.13 0) 0%, var(--bg-base) 62%)",
        }}
      />

      {/* Layer 2: concentric rings emanating from bottom-center */}
      <div style={{ ...FIXED, overflow: "hidden" }}>
        {/* Zero-size anchor at bottom-center — rings position relative to this */}
        <div
          style={{ position: "absolute", bottom: 0, left: "50%", width: 0, height: 0 }}
        >
          {TRIVIA_RINGS.map(({ sizeVw, delay, opacity }, i) => {
            const half = `${sizeVw / 2}vw`;
            const size = `${sizeVw}vw`;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: `-${half}`,
                  bottom: `-${half}`,
                  width: size,
                  height: size,
                }}
              >
                <div
                  className="animate-atm-trivia-ring-pulse"
                  style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: "50%",
                    border: "1px solid rgba(236,72,153,0.80)",
                    opacity,
                    animationDelay: delay,
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Layer 3: electric magenta ambient glow — bottom-center */}
      <div
        style={{
          ...FIXED,
          background:
            "radial-gradient(ellipse 55vw 55vw at 50% 100%, oklch(66% 0.21 350) 0%, transparent 70%)",
          opacity: 0.28,
        }}
      />
    </>
  );
}

/* ── Title Wars — window seat in a book gallery, golden hour */
function TitleWarsAtmosphere() {
  return (
    <>
      {/* Layer 1: warm cream-to-dark radial from top-right */}
      <div
        style={{
          ...FIXED,
          background:
            "radial-gradient(ellipse 75% 60% at 100% 0%, oklch(82% 0.045 70) 0%, oklch(18% 0.025 70) 100%)",
          opacity: 0.65,
        }}
      />

      {/* Layer 2: horizontal ruled lines + single vertical margin hairline */}
      <div
        style={{
          ...FIXED,
          backgroundImage: [
            "repeating-linear-gradient(180deg, transparent 0px, transparent 35px, rgba(254,243,199,0.07) 35px, rgba(254,243,199,0.07) 36px)",
            "linear-gradient(90deg, transparent 17%, rgba(254,243,199,0.09) 17%, rgba(254,243,199,0.09) 17.4%, transparent 17.4%)",
          ].join(", "),
        }}
      />

      {/* Layer 3: warm cream ambient glow — top-right, slow sway */}
      <div
        className="animate-atm-tw-ambient-sway"
        style={{
          ...FIXED,
          background:
            "radial-gradient(ellipse 48vw 48vw at 100% 0%, oklch(88% 0.055 70) 0%, transparent 70%)",
          opacity: 0.16,
        }}
      />
    </>
  );
}

/* ── Public export ─────────────────────────────────────────── */
export default function GameAtmosphere({
  game,
  children,
}: {
  game: GameKey;
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Fixed atmosphere layers — z=0, behind all content */}
      <div aria-hidden="true">
        {game === "prompt-wars"   && <PromptWarsAtmosphere />}
        {game === "predictions"   && <PredictionsAtmosphere />}
        {game === "trivia-royale" && <TriviaAtmosphere />}
        {game === "title-wars"    && <TitleWarsAtmosphere />}
      </div>

      {/* Content wrapper — z=1, sits above the fixed atmosphere */}
      <div style={{ position: "relative", zIndex: 1 }}>
        {children}
      </div>
    </>
  );
}
