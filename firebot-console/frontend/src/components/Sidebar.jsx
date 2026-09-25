import React from "react";

const NAV = [
  { id: "live", label: "Live Ops", icon: LiveIcon },
  { id: "history", label: "History", icon: HistoryIcon },
];

export default function Sidebar({ page, setPage, linkOk }) {
  return (
    <aside className="w-[212px] shrink-0 border-r border-line bg-panel flex flex-col">
      <div className="h-14 flex items-center gap-2.5 px-5 border-b border-line">
        <BrandMark />
        <div className="leading-tight">
          <div className="font-mono text-[13px] text-ink tracking-tight">firebot</div>
          <div className="font-mono text-[9px] text-faint tracking-wide">CONSOLE v0.1</div>
        </div>
      </div>

      <nav className="flex-1 py-3">
        {NAV.map((item) => {
          const active = page === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              className={`w-full flex items-center gap-3 px-5 py-2.5 text-[13px] border-l-2 transition-colors ${
                active
                  ? "border-telemetry text-ink bg-panel2"
                  : "border-transparent text-muted hover:text-ink hover:bg-panel2/60"
              }`}
            >
              <Icon active={active} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t border-line">
        <div className="flex items-center gap-2 font-mono text-[11px] text-muted">
          <span
            className={`h-[6px] w-[6px] rounded-full ${
              linkOk ? "bg-ok" : "bg-alarm pulse-dot"
            }`}
          />
          {linkOk ? "PI LINK OK" : "PI LINK LOST"}
        </div>
      </div>
    </aside>
  );
}

function BrandMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="2" width="20" height="20" rx="3" stroke="#155F82" strokeWidth="1.4" />
      <path
        d="M12 6.5c1.8 2.1 2.6 3.7 2.6 5.2a2.6 2.6 0 1 1-5.2 0c0-.9.4-1.7 1-2.4-.15.75.05 1.35.6 1.55-.2-1.6.4-3 1-4.35Z"
        fill="#B4700A"
      />
    </svg>
  );
}

function LiveIcon({ active }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="3" fill={active ? "#155F82" : "none"} stroke={active ? "#155F82" : "#5F5C53"} strokeWidth="1.3" />
      <circle cx="8" cy="8" r="6.5" stroke={active ? "#155F82" : "#5F5C53"} strokeWidth="1" opacity="0.4" />
    </svg>
  );
}

function HistoryIcon({ active }) {
  const c = active ? "#155F82" : "#5F5C53";
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M2 8a6 6 0 1 1 1.8 4.3" stroke={c} strokeWidth="1.3" strokeLinecap="round" />
      <path d="M2 4v3.5h3.5" stroke={c} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 5v3l2.2 1.3" stroke={c} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
