import React from "react";

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function RunInsights({ summary, anomalies, onSeek }) {
  return (
    <div className="panel p-5 space-y-4">
      <div>
        <h3 className="text-[16px] font-semibold text-ink">Mission summary</h3>
        <p className="text-[13.5px] text-muted leading-relaxed max-w-[64ch] mt-1.5">
          {summary ? summary.text : "No summary is available for this run."}
        </p>
      </div>

      <div className="pt-2 border-t border-line">
        <h3 className="text-[15px] font-semibold text-ink">Anomalies & faults</h3>
        {!anomalies || anomalies.length === 0 ? (
          <p className="text-muted text-[13px] mt-1.5">
            Nominal run telemetry: no sensor dropouts, stalls, or hardware faults detected.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {anomalies.map((a, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => onSeek({ t: a.t, n: i + Date.now() })}
                  className="w-full text-left flex gap-3 items-baseline rounded-lg px-3 py-2 hover:bg-panel2 transition-colors cursor-pointer"
                >
                  <span className="data text-muted text-[12px] shrink-0">{clock(a.t)}</span>
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{
                      background: a.severity === "info" ? "rgb(var(--c-telemetry))" : "rgb(var(--c-flame))",
                    }}
                  />
                  <span className="text-[13px] text-ink max-w-[60ch]">{a.message}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
