import React from "react";

const TONES = {
  neutral: "bg-panel2 text-muted border-line",
  ok: "bg-ok/10 text-ok border-ok/25",
  warn: "bg-warn/10 text-warn border-warn/30",
  alarm: "bg-alarm/10 text-alarm border-alarm/30",
  info: "bg-telemetry/10 text-telemetry border-telemetry/30",
  flame: "bg-flame/10 text-flame border-flame/30",
};

export default function Badge({ tone = "neutral", dot = false, className = "", children }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-medium ${TONES[tone] || TONES.neutral} ${className}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
