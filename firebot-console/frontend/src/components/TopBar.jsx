import React from "react";

const TITLES = {
  live: { title: "Live Operations", sub: "Real-time telemetry and manual control" },
  history: { title: "Run History", sub: "Logged runs from Postgres" },
};

export default function TopBar({ page, mode, onEstop }) {
  const { title, sub } = TITLES[page];
  return (
    <header className="border-b border-line bg-panel">
      <div className="flex items-center justify-between px-6 h-14">
        <div className="leading-tight">
          <div className="text-[14px] text-ink font-medium">{title}</div>
          <div className="text-[11px] text-faint">{sub}</div>
        </div>

        <div className="flex items-center gap-5">
          <div className="font-mono text-[12px] text-muted">
            MODE&nbsp;
            <span className="text-ink">{mode.toUpperCase()}</span>
          </div>

          <button
            onClick={onEstop}
            className="border border-alarm text-alarm font-mono text-[12px] font-medium px-4 py-1.5 hover:bg-alarm hover:text-panel transition-colors"
          >
            E-STOP
          </button>
        </div>
      </div>
    </header>
  );
}
