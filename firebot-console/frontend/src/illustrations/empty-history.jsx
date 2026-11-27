import React from "react";

export default function EmptyHistory({ className = "", title = "Empty run log and mission history" }) {
  return (
    <svg
      viewBox="0 0 400 300"
      className={className}
      role="img"
      aria-label={title}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Background Shadow Card */}
      <rect
        x="135"
        y="60"
        width="160"
        height="200"
        rx="8"
        fill="rgb(var(--c-panel2))"
        stroke="rgb(var(--c-line2))"
        strokeWidth="1.5"
        transform="rotate(4 215 160)"
      />

      {/* Main Foreground Clipboard / Document Card */}
      <rect
        x="110"
        y="50"
        width="180"
        height="215"
        rx="8"
        fill="rgb(var(--c-panel))"
        stroke="rgb(var(--c-ink) / 0.85)"
        strokeWidth="2"
      />

      {/* Top Clip Hardware */}
      <rect
        x="160"
        y="42"
        width="80"
        height="18"
        rx="4"
        fill="rgb(var(--c-panel2))"
        stroke="rgb(var(--c-ink))"
        strokeWidth="1.75"
      />
      <circle cx="200" cy="51" r="3.5" fill="rgb(var(--c-panel))" stroke="rgb(var(--c-ink))" strokeWidth="1.5" />

      {/* Header Lines */}
      <line x1="135" y1="80" x2="195" y2="80" stroke="rgb(var(--c-flame))" strokeWidth="2.5" />
      <line x1="240" y1="80" x2="265" y2="80" stroke="rgb(var(--c-line2))" strokeWidth="2" />

      {/* Table Row Grid Skeleton */}
      <line x1="130" y1="100" x2="270" y2="100" stroke="rgb(var(--c-line))" strokeWidth="1" />
      <line x1="130" y1="135" x2="270" y2="135" stroke="rgb(var(--c-line))" strokeWidth="1" />
      <line x1="130" y1="170" x2="270" y2="170" stroke="rgb(var(--c-line))" strokeWidth="1" />
      <line x1="130" y1="205" x2="270" y2="205" stroke="rgb(var(--c-line))" strokeWidth="1" />

      {/* Dotted Sortie Path Traced on the Page */}
      <path
        d="M 145 190 Q 175 140, 205 160 T 255 115"
        stroke="rgb(var(--c-telemetry))"
        strokeWidth="2"
        strokeDasharray="4 4"
      />

      {/* Start Waypoint (Rover origin) */}
      <circle cx="145" cy="190" r="4.5" fill="rgb(var(--c-panel))" stroke="rgb(var(--c-telemetry))" strokeWidth="2" />
      <circle cx="145" cy="190" r="2" fill="rgb(var(--c-telemetry))" />

      {/* Intermediate Turn Point */}
      <circle cx="205" cy="160" r="3" fill="rgb(var(--c-telemetry))" />

      {/* Goal / Target Marker */}
      <g transform="translate(255, 115)">
        <circle cx="0" cy="0" r="6" fill="rgb(var(--c-flame) / 0.2)" stroke="rgb(var(--c-flame))" strokeWidth="1.5" />
        <circle cx="0" cy="0" r="2.5" fill="rgb(var(--c-flame))" />
      </g>

      {/* Subtle Row Placeholders */}
      <line x1="135" y1="118" x2="180" y2="118" stroke="rgb(var(--c-faint))" strokeWidth="1.5" />
      <line x1="135" y1="152" x2="170" y2="152" stroke="rgb(var(--c-faint))" strokeWidth="1.5" />
      <line x1="135" y1="188" x2="140" y2="188" stroke="rgb(var(--c-faint))" strokeWidth="1.5" />
      <line x1="135" y1="225" x2="190" y2="225" stroke="rgb(var(--c-faint))" strokeWidth="1.5" />
      <line x1="225" y1="225" x2="265" y2="225" stroke="rgb(var(--c-line2))" strokeWidth="1.5" />
    </svg>
  );
}
