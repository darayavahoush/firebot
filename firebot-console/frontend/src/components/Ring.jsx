import React from "react";

export default function Ring({ label, value, low, good }) {
  const R = 32;
  const C = 2 * Math.PI * R;
  const v = Math.max(0, Math.min(1, value ?? 0));
  const pct = Math.round(v * 100);

  // Status tokens
  const stroke = low
    ? "rgb(var(--c-alarm))"
    : good
    ? "rgb(var(--c-ok))"
    : "rgb(var(--c-telemetry))";

  return (
    <div
      className="flex flex-col items-center gap-2 p-3 rounded-xl bg-panel border border-line transition-colors hover:border-line2"
      role="img"
      aria-label={`${label} ${pct} percent`}
    >
      <div className="relative">
        <svg width="84" height="84" viewBox="0 0 84 84" className="overflow-visible">
          {/* Background track */}
          <circle
            cx="42"
            cy="42"
            r={R}
            fill="none"
            stroke="rgb(var(--c-line2))"
            strokeWidth="5"
          />

          {/* Calibrated Ticks */}
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
            <line
              key={deg}
              x1="42"
              y1="6"
              x2="42"
              y2="9"
              stroke="rgb(var(--c-line))"
              strokeWidth="1.5"
              transform={`rotate(${deg} 42 42)`}
            />
          ))}

          {/* Value Progress Arc */}
          <circle
            cx="42"
            cy="42"
            r={R}
            fill="none"
            stroke={stroke}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${C * v} ${C}`}
            transform="rotate(-90 42 42)"
            style={{ transition: "stroke-dasharray 0.5s ease-out" }}
          />

          {/* Central Readout */}
          <text
            x="42"
            y="47"
            textAnchor="middle"
            className="data text-ink font-semibold"
            fill="currentColor"
            fontSize="18"
          >
            {pct}
          </text>
          <text
            x="59"
            y="38"
            textAnchor="start"
            className="data text-faint"
            fill="currentColor"
            fontSize="9"
          >
            %
          </text>
        </svg>

        {/* Warning Indicator Dot */}
        {low && (
          <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-alarm pulse-dot border border-panel" />
        )}
      </div>

      <div className="flex flex-col items-center text-center">
        <span className="text-[12.5px] font-medium text-ink tracking-tight">{label}</span>
        <span
          className={`text-[10.5px] ${
            low ? "text-alarm font-semibold" : good ? "text-ok font-medium" : "text-faint"
          }`}
        >
          {low ? "Low level" : good ? "Optimal" : "Nominal"}
        </span>
      </div>
    </div>
  );
}
