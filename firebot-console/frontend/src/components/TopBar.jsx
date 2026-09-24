import React from "react";

export default function TopBar({ page, setPage, linkOk, mode, onEstop }) {
  return (
    <header className="border-b border-line bg-panel">
      <div className="flex items-center justify-between px-6 h-14">
        <div className="flex items-center gap-8">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[13px] tracking-tight text-ink">
              FIREBOT
            </span>
            <span className="font-mono text-[11px] text-faint">
              OPERATOR CONSOLE
            </span>
          </div>

          <nav className="flex items-center gap-1">
            <NavItem label="Live" active={page === "live"} onClick={() => setPage("live")} />
            <NavItem label="History" active={page === "history"} onClick={() => setPage("history")} />
          </nav>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 font-mono text-[12px] text-muted">
            <span
              className={`h-[7px] w-[7px] rounded-full ${
                linkOk ? "bg-ok" : "bg-alarm pulse-dot"
              }`}
            />
            {linkOk ? "LINK OK" : "LINK LOST"}
          </div>

          <div className="font-mono text-[12px] text-muted border-l border-line pl-6">
            MODE&nbsp;
            <span className="text-ink">{mode.toUpperCase()}</span>
          </div>

          <button
            onClick={onEstop}
            className="border border-alarm text-alarm font-mono text-[12px] font-medium px-4 py-1.5 hover:bg-alarm hover:text-base transition-colors"
          >
            E-STOP
          </button>
        </div>
      </div>
    </header>
  );
}

function NavItem({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-[13px] border-b-2 transition-colors ${
        active
          ? "border-telemetry text-ink"
          : "border-transparent text-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}
