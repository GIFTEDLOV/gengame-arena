"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Footer from "@/components/shell/Footer";

const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const hasPrivy = !!privyAppId && privyAppId !== "your_privy_app_id_here";

/* ── Floating particle dot ───────────────────────────────── */
interface Particle { id: number; left: string; delay: string; duration: string; size: number; color: string; }
const PARTICLE_COLORS = ["#8b5cf6", "#fbbf24", "#2dd4bf", "#ec4899", "#a78bfa"];
function useParticles(count: number): Particle[] {
  const [particles, setParticles] = useState<Particle[]>([]);
  useEffect(() => {
    setParticles(
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: `${Math.random() * 100}%`,
        delay: `${(Math.random() * 4).toFixed(2)}s`,
        duration: `${(3 + Math.random() * 4).toFixed(2)}s`,
        size: Math.random() < 0.5 ? 3 : 4,
        color: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
      }))
    );
  }, [count]);
  return particles;
}

function ParticleField() {
  const particles = useParticles(18);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {particles.map((p) => (
        <span
          key={p.id}
          className="animate-float-up absolute bottom-0 rounded-full opacity-0"
          style={{
            left: p.left,
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            animationDelay: p.delay,
            animationDuration: p.duration,
          }}
        />
      ))}
    </div>
  );
}

/* ── Game feature cards ──────────────────────────────────── */
const GAMES = [
  {
    name: "Prompt Wars",
    href: "/prompt-wars",
    accent: "var(--game-prompt-wars)",
    icon: "✍️",
    desc: "Write the best prompt to match an AI-generated target. The closest prompt wins.",
    tag: "Creative",
  },
  {
    name: "Real-World Predictions",
    href: "/predictions",
    accent: "var(--game-predictions)",
    icon: "📈",
    desc: "Forecast outcomes and let AI fetch live web data to resolve the truth on-chain.",
    tag: "Strategic",
  },
  {
    name: "Trivia Royale",
    href: "/trivia-royale",
    accent: "var(--game-trivia)",
    icon: "🧠",
    desc: "Battle-royale trivia with AI-generated questions. Every answer judged on-chain.",
    tag: "Competitive",
  },
  {
    name: "Title Wars",
    href: "/title-wars",
    accent: "var(--game-title-wars)",
    icon: "📜",
    desc: "Submit the sharpest title for a literary excerpt. AI validators pick the winner.",
    tag: "Literary",
  },
];

/* ── How it works steps ──────────────────────────────────── */
const HOW_STEPS = [
  {
    n: "01",
    title: "Connect and play",
    body: "Sign in with GitHub, email, or as a guest. Pick a game and make your move — no crypto knowledge needed.",
  },
  {
    n: "02",
    title: "AI validators judge",
    body: "Multiple independent AI validators reach consensus on-chain via GenLayer's Optimistic Democracy protocol.",
  },
  {
    n: "03",
    title: "Truth recorded forever",
    body: "Results are immutable. Your wins, losses, and rank are permanently written to the chain — provably fair.",
  },
];

/* ── CTA button ──────────────────────────────────────────── */
function CtaButton({ label, href, primary }: { label: string; href: string; primary?: boolean }) {
  return (
    <Link
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 44,
        paddingLeft: "1.5rem",
        paddingRight: "1.5rem",
        borderRadius: "var(--radius-pill)",
        fontWeight: 600,
        fontSize: "var(--text-sm)",
        fontFamily: "var(--font-display)",
        textDecoration: "none",
        transition: `background var(--duration-fast), box-shadow var(--duration-fast), transform var(--duration-fast) var(--ease-spring)`,
        ...(primary
          ? {
              backgroundColor: "var(--accent-platform)",
              color: "#fff",
              boxShadow: "var(--glow-accent)",
            }
          : {
              backgroundColor: "transparent",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-strong)",
            }),
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLAnchorElement;
        el.style.transform = "translateY(-1px)";
        if (primary) el.style.backgroundColor = "var(--accent-platform-hi)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLAnchorElement;
        el.style.transform = "translateY(0)";
        if (primary) el.style.backgroundColor = "var(--accent-platform)";
      }}
    >
      {label}
    </Link>
  );
}

/* ── Main page ───────────────────────────────────────────── */
export default function LandingPage() {
  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg-base)", color: "var(--text-primary)" }}>

      {/* ── Minimal landing header ──────────────────────────── */}
      <header
        className="sticky top-0 z-50 flex items-center justify-between px-6 sm:px-10"
        style={{
          height: "var(--header-height)",
          backgroundColor: "rgba(10,10,15,0.85)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
            <circle cx="10" cy="10" r="10" fill="var(--accent-platform)" />
            <circle cx="10" cy="10" r="5" fill="var(--accent-platform-hi)" opacity="0.6" />
            <circle cx="10" cy="10" r="2" fill="white" />
          </svg>
          <span
            className="font-bold tracking-tight text-sm"
            style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
          >
            Gengame Arena
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href="/sign-in"
            className="text-xs font-medium"
            style={{ color: "var(--text-secondary)", textDecoration: "none" }}
          >
            Sign In
          </Link>
          <Link
            href="/sign-in"
            className="text-xs font-semibold"
            style={{
              backgroundColor: "var(--accent-platform)",
              color: "#fff",
              padding: "6px 14px",
              borderRadius: "var(--radius-pill)",
              textDecoration: "none",
            }}
          >
            Play Free
          </Link>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────── */}
      <section
        className="relative flex flex-col items-center justify-center text-center overflow-hidden"
        style={{ minHeight: "calc(100vh - var(--header-height))", padding: "6rem 1.5rem 4rem" }}
      >
        {/* Ambient glows */}
        <div
          className="pointer-events-none absolute"
          aria-hidden
          style={{
            top: "-10rem",
            left: "50%",
            transform: "translateX(-50%)",
            width: "40rem",
            height: "40rem",
            background: "radial-gradient(circle, var(--accent-platform-lo) 0%, transparent 70%)",
            opacity: 0.18,
            filter: "blur(40px)",
          }}
        />

        <ParticleField />

        {/* Eyebrow chip */}
        <div
          className="mb-6 inline-flex items-center gap-2 rounded-full px-3 py-1"
          style={{
            backgroundColor: "rgba(139,92,246,0.12)",
            border: "1px solid rgba(139,92,246,0.25)",
            fontSize: "var(--text-xs)",
            color: "var(--accent-platform-hi)",
            fontFamily: "var(--font-mono)",
          }}
        >
          <span
            className="animate-pulse-dot inline-block rounded-full"
            style={{ width: 6, height: 6, backgroundColor: "var(--accent-platform-hi)" }}
          />
          Powered by GenLayer · AI consensus on-chain
        </div>

        {/* Headline */}
        <h1
          className="font-bold leading-none tracking-tight mb-6"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(2.4rem, 8vw, 5rem)",
            color: "var(--text-primary)",
            maxWidth: "18ch",
          }}
        >
          Where AI judges{" "}
          <span style={{ color: "var(--accent-platform-hi)" }}>every game</span>
          {" "}on&#8209;chain
        </h1>

        {/* Sub-headline */}
        <p
          className="mb-10 leading-relaxed"
          style={{
            color: "var(--text-secondary)",
            fontSize: "var(--text-lg)",
            maxWidth: "42ch",
          }}
        >
          Competitive mini-games where the rules, judging, and results are enforced
          by AI validators — not moderators. No disputes. No trust required.
        </p>

        {/* CTAs */}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <CtaButton label="Play for Free →" href="/sign-in" primary />
          <CtaButton label="How it works" href="#how-it-works" />
        </div>

        {/* Scroll hint */}
        <div
          className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1"
          style={{ color: "var(--text-disabled)" }}
          aria-hidden
        >
          <span style={{ fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>scroll</span>
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </section>

      {/* ── Game showcase ──────────────────────────────────── */}
      <section
        className="mx-auto max-w-6xl px-6 sm:px-10 py-20"
        id="games"
      >
        <div className="text-center mb-12">
          <h2
            className="font-bold mb-3"
            style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-3xl)", color: "var(--text-primary)" }}
          >
            Four games. One arena.
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-base)", maxWidth: "44ch", margin: "0 auto" }}>
            Each game has different mechanics — but every verdict comes from the same source: on-chain AI consensus.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {GAMES.map((g) => (
            <Link
              key={g.name}
              href={g.href}
              style={{ textDecoration: "none" }}
              className="group block"
            >
              <div
                className="relative overflow-hidden"
                style={{
                  backgroundColor: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  padding: "1.5rem",
                  transition: `transform var(--duration-normal) var(--ease-out), border-color var(--duration-normal), box-shadow var(--duration-normal)`,
                  boxShadow: "var(--shadow-card)",
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLDivElement;
                  el.style.transform = "translateY(-2px)";
                  el.style.borderColor = "var(--border-strong)";
                  el.style.boxShadow = "var(--shadow-hover)";
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLDivElement;
                  el.style.transform = "translateY(0)";
                  el.style.borderColor = "var(--border)";
                  el.style.boxShadow = "var(--shadow-card)";
                }}
              >
                {/* Top accent */}
                <div
                  className="absolute top-0 left-0 right-0 h-px"
                  style={{ backgroundColor: g.accent, opacity: 0.5 }}
                />

                <div className="flex items-start gap-4">
                  <span className="text-3xl" role="img" aria-label={g.name}>{g.icon}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p
                        className="font-semibold text-sm"
                        style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}
                      >
                        {g.name}
                      </p>
                      <span
                        className="text-xs rounded-full px-2 py-0.5"
                        style={{
                          backgroundColor: "rgba(255,255,255,0.05)",
                          color: g.accent,
                          fontFamily: "var(--font-mono)",
                          border: `1px solid ${g.accent}33`,
                        }}
                      >
                        {g.tag}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                      {g.desc}
                    </p>
                  </div>
                </div>

                <div
                  className="mt-4 text-xs font-semibold group-hover:translate-x-1 transition-transform duration-200 inline-block"
                  style={{ color: g.accent }}
                >
                  Play →
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────── */}
      <section
        id="how-it-works"
        className="py-20"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <div className="mx-auto max-w-6xl px-6 sm:px-10">
          <div className="text-center mb-14">
            <h2
              className="font-bold mb-3"
              style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-3xl)", color: "var(--text-primary)" }}
            >
              How it works
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-base)", maxWidth: "40ch", margin: "0 auto" }}>
              From sign-in to on-chain result in three steps.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 relative">
            {/* Connector line on desktop */}
            <div
              className="hidden sm:block absolute top-8 h-px"
              style={{ left: "16.67%", right: "16.67%", backgroundColor: "var(--border)" }}
              aria-hidden
            />
            {HOW_STEPS.map((s) => (
              <div key={s.n} className="relative flex flex-col items-start sm:items-center sm:text-center gap-4">
                {/* Step number */}
                <div
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl font-bold text-lg"
                  style={{
                    fontFamily: "var(--font-mono)",
                    backgroundColor: "rgba(139,92,246,0.12)",
                    border: "1px solid rgba(139,92,246,0.25)",
                    color: "var(--accent-platform-hi)",
                    position: "relative",
                    zIndex: 1,
                  }}
                >
                  {s.n}
                </div>
                <div>
                  <p
                    className="font-semibold mb-2"
                    style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)", fontSize: "var(--text-base)" }}
                  >
                    {s.title}
                  </p>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                    {s.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stats strip ────────────────────────────────────── */}
      <section
        className="py-14"
        style={{ borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}
      >
        <div className="mx-auto max-w-5xl px-6 sm:px-10 grid grid-cols-2 sm:grid-cols-4 gap-8 text-center">
          {[
            { value: "5", label: "Game contracts" },
            { value: "∞", label: "AI-judged matches" },
            { value: "0", label: "Moderators needed" },
            { value: "100%", label: "On-chain results" },
          ].map(({ value, label }) => (
            <div key={label}>
              <p
                className="font-bold mb-1"
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "var(--text-3xl)",
                  color: "var(--accent-platform-hi)",
                }}
              >
                {value}
              </p>
              <p className="text-xs" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                {label}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Final CTA ──────────────────────────────────────── */}
      <section className="py-24 text-center px-6">
        {/* Ambient glow behind CTA */}
        <div
          className="pointer-events-none absolute left-1/2 -translate-x-1/2"
          aria-hidden
          style={{
            width: "28rem",
            height: "14rem",
            background: "radial-gradient(ellipse, var(--accent-platform-lo) 0%, transparent 70%)",
            opacity: 0.15,
            filter: "blur(32px)",
          }}
        />
        <div className="relative">
          <h2
            className="font-bold mb-4"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(1.8rem, 5vw, 3.2rem)",
              color: "var(--text-primary)",
              maxWidth: "20ch",
              margin: "0 auto 1rem",
            }}
          >
            Ready to test your wit against the chain?
          </h2>
          <p
            className="mb-10"
            style={{ color: "var(--text-secondary)", fontSize: "var(--text-base)", maxWidth: "38ch", margin: "0 auto 2.5rem" }}
          >
            No wallet setup. No gas fees. Just sign in and play — results on-chain, always.
          </p>
          <CtaButton label="Enter the Arena →" href="/sign-in" primary />
        </div>
      </section>

      <Footer />
    </div>
  );
}
