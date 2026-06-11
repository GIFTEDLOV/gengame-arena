export default function Footer() {
  return (
    <footer
      className="flex flex-col sm:flex-row items-center justify-between gap-4 px-6 py-5 text-xs"
      style={{
        borderTop: "1px solid var(--border)",
        color: "var(--text-tertiary)",
        fontFamily: "var(--font-body)",
      }}
    >
      <div className="flex items-center gap-4">
        <span>© 2025 Gengame Arena</span>
        <span style={{ color: "var(--border-strong)" }}>·</span>
        <a
          href="https://genlayer.com"
          target="_blank"
          rel="noreferrer"
          className="hover:underline transition-colors"
          style={{ color: "var(--accent-platform)" }}
        >
          Built on GenLayer
        </a>
      </div>

      <p
        className="text-center sm:text-right"
        style={{ color: "var(--text-disabled)", fontStyle: "italic" }}
      >
        Every game&apos;s outcome decided by AI consensus on-chain
      </p>

      <div className="flex items-center gap-4">
        <a
          href="https://docs.genlayer.com"
          target="_blank"
          rel="noreferrer"
          className="hover:underline"
        >
          GenLayer Docs
        </a>
        <a
          href="https://github.com"
          target="_blank"
          rel="noreferrer"
          className="hover:underline"
        >
          GitHub
        </a>
        <a href="#" className="hover:underline">
          Discord
        </a>
      </div>
    </footer>
  );
}
