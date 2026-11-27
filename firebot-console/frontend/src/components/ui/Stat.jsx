import React from "react";

/** Single labelled metric. `tone` colours the value only. */
export default function Stat({ label, value, hint, tone, icon, className = "" }) {
  const toneCls = { ok: "text-ok", warn: "text-warn", alarm: "text-alarm", info: "text-telemetry" }[tone] || "text-ink";
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="flex items-center gap-1.5 text-[12px] text-muted">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`data text-[20px] font-semibold leading-none ${toneCls}`}>{value}</div>
      {hint && <div className="text-[12px] text-faint">{hint}</div>}
    </div>
  );
}
