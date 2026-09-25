import React from "react";

export default function StatusStrip({ frame, mode, logCount }) {
  return (
    <div className="grid grid-cols-4 divide-x divide-line border-b border-line bg-panel">
      <Stat label="System" value={frame ? "OPERATIONAL" : "CONNECTING"} tone={frame ? "ok" : "muted"} />
      <Stat label="Mode" value={mode.toUpperCase()} tone="ink" />
      <Stat
        label="Link Latency"
        value={frame ? `${frame.last_ack_ms} ms` : "—"}
        tone={frame && frame.last_ack_ms > 200 ? "warn" : "ink"}
      />
      <Stat label="Commands Sent" value={logCount} tone="ink" />
    </div>
  );
}

const TONE = {
  ok: "text-ok",
  warn: "text-warn",
  alarm: "text-alarm",
  muted: "text-faint",
  ink: "text-ink",
};

function Stat({ label, value, tone }) {
  return (
    <div className="px-6 py-3">
      <div className="text-[10px] tracking-wide text-faint mb-1">{label}</div>
      <div className={`data text-[15px] ${TONE[tone]}`}>{value}</div>
    </div>
  );
}
