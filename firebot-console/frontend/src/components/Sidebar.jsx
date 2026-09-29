import React from "react";

const NAV = [
  { id: "live", label: "Live" },
  { id: "sim", label: "Simulator" },
  { id: "mujoco", label: "MuJoCo" },
  { id: "history", label: "History" },
  { id: "about", label: "About" },
];

export default function Sidebar({ page, setPage, linkOk, notifOn, onToggleNotif }) {
  return (
    <aside className="w-[76px] shrink-0 bg-panel border-r border-line flex flex-col items-center py-5 gap-6">
      <div
        className="font-display font-extrabold text-[22px] tracking-tight text-ink select-none"
        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
      >
        Nirvana
      </div>
      <nav className="flex-1 flex flex-col items-center gap-2" aria-label="Pages">
        {NAV.map((item) => {
          const active = page === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              aria-current={active ? "page" : undefined}
              className={`relative w-full py-3 text-[13px] transition-colors ${
                active ? "text-ink font-bold" : "text-faint hover:text-ink"
              }`}
              style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
            >
              {active && (
                <span className="absolute right-0 top-0 bottom-0 w-[3px]" style={{ background: "linear-gradient(0deg,#5a1a86,#c4286f,#ff8a2a,#fff2c9)" }} />
              )}
              {item.label}
            </button>
          );
        })}
      </nav>
      {onToggleNotif && (
        <button
          onClick={onToggleNotif}
          aria-pressed={!!notifOn}
          aria-label={notifOn ? "Turn off alerts" : "Turn on alerts"}
          title={notifOn ? "Alerts on: you'll be notified when this tab is in the background" : "Turn on alerts"}
          className={`h-9 w-9 rounded-full flex items-center justify-center border transition-colors ${notifOn ? "border-telemetry text-telemetry bg-telemetry/15" : "border-line text-faint hover:text-ink"}`}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.5 11.5h9l-1.2-1.6V7a3.3 3.3 0 0 0-6.6 0v2.9L3.5 11.5Z" /><path d="M6.6 13.4a1.5 1.5 0 0 0 2.8 0" />
            {!notifOn && <path d="M2.5 2.5l11 11" />}
          </svg>
        </button>
      )}
      <div
        title={linkOk ? "Robot link up" : "Robot link lost"}
        className={`h-2.5 w-2.5 rounded-full ${linkOk ? "bg-ok" : "bg-alarm pulse-dot"}`}
      />
    </aside>
  );
}
