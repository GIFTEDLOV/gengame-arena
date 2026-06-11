import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        "bg-base":         "var(--bg-base)",
        "bg-elevated":     "var(--bg-elevated)",
        "accent-platform": "var(--accent-platform)",
        "accent-platform-hi": "var(--accent-platform-hi)",
        "accent-platform-lo": "var(--accent-platform-lo)",
        "game-prompt":     "var(--game-prompt-wars)",
        "game-predictions":"var(--game-predictions)",
        "game-trivia":     "var(--game-trivia)",
        "game-title":      "var(--game-title-wars)",
        "tx-success":      "var(--success)",
        "tx-warning":      "var(--warning)",
        "tx-danger":       "var(--danger)",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        body:    ["var(--font-body)",    "system-ui", "sans-serif"],
        mono:    ["var(--font-mono)",    "monospace"],
        serif:   ["var(--font-serif)",   "Georgia",   "serif"],
      },
      borderRadius: {
        sm:   "var(--radius-sm)",
        DEFAULT: "var(--radius)",
        md:   "var(--radius-md)",
        lg:   "var(--radius-lg)",
        pill: "var(--radius-pill)",
      },
      transitionTimingFunction: {
        "ease-out-smooth": "var(--ease-out)",
        "ease-spring":     "var(--ease-spring)",
      },
      transitionDuration: {
        fast:   "150ms",
        normal: "240ms",
        slow:   "400ms",
      },
    },
  },
  plugins: [],
};

export default config;
