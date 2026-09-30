import React, { useState, useMemo } from "react";
import { playSound } from "../lib/sound.js";

const SOURCE_BADGES = {
  typed: { label: "TYPED", cls: "bg-telemetry/15 text-telemetry border-telemetry/30" },
  voice: { label: "VOICE", cls: "bg-ok/15 text-ok border-ok/30" },
  system: { label: "SYSTEM", cls: "bg-warn/15 text-warn border-warn/30" },
  auto: { label: "AUTO", cls: "bg-panel2 text-muted border-line" },
};

export default function CommandLog({ entries = [] }) {
  const [filter, setFilter] = useState("all");
  const [copied, setCopied] = useState(false);

  const filtered = useMemo(() => {
    if (filter === "all") return entries;
    return entries.filter((e) => e.source === filter);
  }, [entries, filter]);

  const copyLog = () => {
    playSound("click");
    const text = entries.map((e) => `[${e.time}] [${e.source.toUpperCase()}] ${e.text}`).join("\n");
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="panel flex flex-col h-full">
      {/* Header with filters and copy action */}
      <div className="px-4 py-3 bg-panel2/60 border-b border-line flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono uppercase tracking-wider text-muted font-medium">
            Command Audit Log
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-panel border border-line text-faint">
            {entries.length} EVENTS
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Source Filter Chips */}
          <div className="flex items-center gap-1 bg-panel p-0.5 rounded-lg border border-line">
            {["all", "typed", "voice", "system"].map((f) => (
              <button
                key={f}
                onClick={() => { playSound("click"); setFilter(f); }}
                className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-md transition-colors ${
                  filter === f
                    ? "bg-telemetry text-base font-bold"
                    : "text-faint hover:text-ink"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Copy Button */}
          <button
            onClick={copyLog}
            title="Copy command audit log to clipboard"
            className="text-[10px] font-mono px-2 py-1 rounded-lg border border-line bg-panel hover:text-ink text-muted transition-colors flex items-center gap-1"
          >
            {copied ? (
              <span className="text-ok">✓ COPIED</span>
            ) : (
              <span>COPY</span>
            )}
          </button>
        </div>
      </div>

      {/* Terminal Output */}
      <div className="border-t border-line flex-1 overflow-y-auto max-h-[280px] font-mono text-[11px] p-2 space-y-1 bg-[#0A0712]/50">
        {filtered.length === 0 && (
          <div className="py-8 text-center text-faint font-mono">
            {entries.length === 0 ? "No commands dispatched yet" : "No events match this filter"}
          </div>
        )}

        {filtered.map((e, i) => {
          const badge = SOURCE_BADGES[e.source] || SOURCE_BADGES.auto;
          return (
            <div
              key={i}
              className="flex items-start gap-2.5 px-2.5 py-1 rounded-lg hover:bg-panel2/50 transition-colors border border-transparent hover:border-line/40 group"
            >
              <span className="text-faint w-[64px] shrink-0 tabular-nums">
                {e.time}
              </span>
              <span
                className={`text-[9px] font-bold px-1.5 py-0.2 rounded border uppercase tracking-wider shrink-0 ${badge.cls}`}
              >
                {badge.label}
              </span>
              <span className="text-ink break-all font-medium">
                {e.text}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
