import React from "react";
import { PanelHeader } from "./TelemetryGauges.jsx";

const SOURCE_STYLE = {
  typed: "text-telemetry",
  voice: "text-ok",
  auto: "text-muted",
  system: "text-warn",
};

export default function CommandLog({ entries }) {
  return (
    <div className="panel flex flex-col h-full">
      <PanelHeader label="Command Log" right={<span className="font-mono text-[10px] text-faint">{entries.length} entries</span>} />
      <div className="border-t border-line flex-1 overflow-y-auto max-h-[260px] font-mono text-[11px]">
        {entries.length === 0 && (
          <div className="px-4 py-6 text-center text-faint">No activity yet</div>
        )}
        {entries.map((e, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-4 py-1.5 border-b border-line/60 last:border-0"
          >
            <span className="text-faint w-[64px] shrink-0">{e.time}</span>
            <span className={`w-[52px] shrink-0 uppercase ${SOURCE_STYLE[e.source] ?? "text-muted"}`}>
              {e.source}
            </span>
            <span className="text-ink truncate">{e.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
