import React, { useState, useMemo } from "react";
import { playSound } from "../lib/sound.js";
import { EmptyState } from "./ui";

const SOURCE_BADGES = {
  typed: { label: "Typed", cls: "bg-telemetry/15 text-telemetry border-telemetry/30" },
  voice: { label: "Voice", cls: "bg-ok/15 text-ok border-ok/30" },
  system: { label: "System", cls: "bg-warn/15 text-warn border-warn/30" },
  auto: { label: "Auto", cls: "bg-panel2 text-muted border-line" },
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
    const text = entries.map((e) => `[${e.time}] [${e.source}] ${e.text}`).join("\n");
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="panel flex flex-col h-full">
      {/* Header with filters and copy action */}
      <div className="px-4 py-3 bg-panel2/60 border-b border-line flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="panel-eyebrow">Command audit log</span>
          <span className="data text-[11px] px-1.5 py-0.5 rounded bg-panel border border-line text-faint">
            {entries.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Source Filter Chips */}
          <div className="flex items-center gap-1 bg-panel p-0.5 rounded-lg border border-line" role="group" aria-label="Filter command sources">
            {["all", "typed", "voice", "system"].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => {
                  playSound("click");
                  setFilter(f);
                }}
                className={`text-[11px] capitalize px-2 py-0.5 rounded-md transition-colors ${
                  filter === f
                    ? "bg-telemetry text-onaccent font-medium"
                    : "text-muted hover:text-ink"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Copy Button */}
          <button
            type="button"
            onClick={copyLog}
            title="Copy command audit log to clipboard"
            className="text-[11px] px-2 py-1 rounded-lg border border-line bg-panel hover:text-ink text-muted transition-colors flex items-center gap-1"
          >
            {copied ? <span className="text-ok font-medium">Copied</span> : <span>Copy</span>}
          </button>
        </div>
      </div>

      {/* Terminal Output */}
      <div className="flex-1 overflow-y-auto max-h-[300px] p-3 space-y-1.5 bg-panel2/20">
        {filtered.length === 0 ? (
          <EmptyState
            illustration="empty-log"
            title={entries.length === 0 ? "No commands dispatched" : "No matching commands"}
            description={
              entries.length === 0
                ? "Dispatched manual, voice, and system commands will appear here in chronological order."
                : `No events found matching the "${filter}" filter.`
            }
          />
        ) : (
          filtered.map((e, i) => {
            const badge = SOURCE_BADGES[e.source] || SOURCE_BADGES.auto;
            return (
              <div
                key={i}
                className="flex items-start gap-2.5 px-2.5 py-1.5 rounded-md hover:bg-panel2 transition-colors border border-transparent hover:border-line group text-[12px]"
              >
                <span className="data text-faint w-[68px] shrink-0">{e.time}</span>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border shrink-0 ${badge.cls}`}>
                  {badge.label}
                </span>
                <span className="text-ink break-all font-mono leading-relaxed">{e.text}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
