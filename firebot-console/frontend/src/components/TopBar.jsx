import React from "react";

const TITLES = {
  live: { title: "Live Operations", sub: "Real-time telemetry and manual control" },
  sim: { title: "Simulator", sub: "Procedural map, mock sensors, planner, voice control" },
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
            className="bg-alarm text-[#1A0805] font-mono text-[12px] font-semibold tracking-wide px-5 py-2 rounded-full shadow-[0_0_16px_rgba(240,96,74,0.45)] hover:brightness-110 active:scale-95 transition"
          >
            E-STOP
          </button>
        </div>
      </div>
    </header>
  );
}
