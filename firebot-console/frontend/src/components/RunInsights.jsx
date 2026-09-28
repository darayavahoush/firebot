import React from "react";

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function RunInsights({ summary, anomalies, onSeek }) {
  return (
    <div>
      <h3 className="font-display font-extrabold text-[20px] tracking-tight">What happened</h3>
      <p className="text-[15px] leading-relaxed max-w-[62ch] mt-2">
        {summary ? summary.text : "No summary is available for this run."}
      </p>
      <h3 className="font-display font-extrabold text-[20px] tracking-tight mt-6">Faults found</h3>
      {!anomalies || anomalies.length === 0 ? (
        <p className="text-muted text-[14px] mt-2">Nothing odd in this run's telemetry: no stuck sensors, leaks or dropouts.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {anomalies.map((a, i) => (
            <li key={i}>
              <button onClick={() => onSeek({ t: a.t, n: i + Date.now() })}
                className="w-full text-left flex gap-3 items-baseline rounded-[8px] px-3 py-2 hover:bg-panel">
                <span className="data text-muted shrink-0">{clock(a.t)}</span>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: a.severity === "info" ? "#5a1a86" : "#ff8a2a" }} />
                <span className="text-[14px] max-w-[60ch]">{a.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
