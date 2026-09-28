import React from "react";

const NAV = [
  { id: "live", label: "Live" },
  { id: "sim", label: "Simulator" },
  { id: "history", label: "History" },
  { id: "about", label: "About" },
];

export default function Sidebar({ page, setPage, linkOk }) {
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
      <div
        title={linkOk ? "Robot link up" : "Robot link lost"}
        className={`h-2.5 w-2.5 rounded-full ${linkOk ? "bg-ok" : "bg-alarm pulse-dot"}`}
      />
    </aside>
  );
}
