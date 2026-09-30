import React from "react";

export default function Ring({ label, value, low, good }) {
  const R = 32;
  const C = 2 * Math.PI * R;
  const v = Math.max(0, Math.min(1, value ?? 0));
  const pct = Math.round(v * 100);

  // Status colors
  const stroke = low
    ? "#FF4A2B"
    : good
    ? "#7DE3B0"
    : "#F0559B";

  const glowColor = low
    ? "rgba(255, 74, 43, 0.4)"
    : good
    ? "rgba(125, 227, 176, 0.4)"
    : "rgba(240, 85, 155, 0.4)";

  return (
    <div
      className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-panel/60 border border-line backdrop-blur-sm transition-all duration-200 hover:border-line/80 hover:bg-panel"
      role="img"
      aria-label={`${label} ${pct} percent`}
    >
      <div className="relative">
        <svg width="84" height="84" viewBox="0 0 84 84" className="overflow-visible">
          <defs>
            <filter id={`glow-${label.replace(/\s+/g, "")}`} x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor={stroke} floodOpacity="0.5" />
            </filter>
          </defs>

          {/* Background track */}
          <circle
            cx="42"
            cy="42"
            r={R}
            fill="none"
            stroke="rgba(226, 214, 255, 0.08)"
            strokeWidth="6"
          />

          {/* Calibrated Ticks */}
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
            <line
              key={deg}
              x1="42"
              y1="6"
              x2="42"
              y2="9"
              stroke="rgba(226, 214, 255, 0.18)"
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
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${C * v} ${C}`}
            transform="rotate(-90 42 42)"
            filter={`url(#glow-${label.replace(/\s+/g, "")})`}
            style={{ transition: "stroke-dasharray 0.5s ease-out" }}
          />

          {/* Central Readout */}
          <text
            x="42"
            y="47"
            textAnchor="middle"
            className="data font-mono font-bold"
            fill="#F1ECFA"
            fontSize="18"
          >
            {pct}
          </text>
          <text
            x="59"
            y="38"
            textAnchor="start"
            className="font-mono text-[9px] fill-faint"
          >
            %
          </text>
        </svg>

        {/* Warning Indicator Dot */}
        {low && (
          <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-alarm pulse-dot border-2 border-panel shadow-[0_0_8px_#ff4a2b]" />
        )}
      </div>

      <div className="flex flex-col items-center">
        <span className="text-[12px] font-medium text-ink tracking-tight">{label}</span>
        <span className={`text-[10px] font-mono uppercase tracking-wider ${
          low ? "text-alarm font-bold" : good ? "text-ok" : "text-faint"
        }`}>
          {low ? "LOW LEVEL" : good ? "OPTIMAL" : "NOMINAL"}
        </span>
      </div>
    </div>
  );
}
