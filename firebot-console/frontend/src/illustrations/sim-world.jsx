import React from "react";

export default function SimWorld({ className = "", title = "Top-down 2D simulation floor plan with planned path and fire target" }) {
  return (
    <svg
      viewBox="0 0 640 400"
      className={className}
      role="img"
      aria-label={title}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Background Floor Grid */}
      <g stroke="rgb(var(--c-line))" strokeWidth="0.75" opacity="0.6">
        {Array.from({ length: 15 }).map((_, i) => (
          <line key={`vg-${i}`} x1={40 + i * 40} y1="30" x2={40 + i * 40} y2="370" />
        ))}
        {Array.from({ length: 9 }).map((_, i) => (
          <line key={`hg-${i}`} x1="40" y1={40 + i * 40} x2="600" y2={40 + i * 40} />
        ))}
      </g>

      {/* Building Perimeter Wall */}
      <rect
        x="60"
        y="50"
        width="520"
        height="300"
        rx="4"
        fill="rgb(var(--c-panel2) / 0.4)"
        stroke="rgb(var(--c-ink) / 0.85)"
        strokeWidth="3"
      />

      {/* Interior Partition Walls & Doorway Openings */}
      {/* Room 1 (Top Left) */}
      <line x1="220" y1="50" x2="220" y2="150" stroke="rgb(var(--c-ink))" strokeWidth="2.5" />
      <line x1="220" y1="190" x2="220" y2="230" stroke="rgb(var(--c-ink))" strokeWidth="2.5" />
      {/* Door 1 swing arc */}
      <path d="M 220 150 A 40 40 0 0 1 260 190" stroke="rgb(var(--c-line2))" strokeWidth="1.25" strokeDasharray="3 3" />
      <line x1="220" y1="150" x2="260" y2="150" stroke="rgb(var(--c-line2))" strokeWidth="1.5" />

      {/* Horizontal corridor wall */}
      <line x1="60" y1="230" x2="160" y2="230" stroke="rgb(var(--c-ink))" strokeWidth="2.5" />
      <line x1="200" y1="230" x2="380" y2="230" stroke="rgb(var(--c-ink))" strokeWidth="2.5" />

      {/* Room 2 (Right Hall) */}
      <line x1="380" y1="50" x2="380" y2="130" stroke="rgb(var(--c-ink))" strokeWidth="2.5" />
      <line x1="380" y1="170" x2="380" y2="350" stroke="rgb(var(--c-ink))" strokeWidth="2.5" />
      {/* Door 2 swing arc */}
      <path d="M 380 130 A 40 40 0 0 1 420 170" stroke="rgb(var(--c-line2))" strokeWidth="1.25" strokeDasharray="3 3" />
      <line x1="380" y1="130" x2="420" y2="130" stroke="rgb(var(--c-line2))" strokeWidth="1.5" />

      {/* Internal Obstacle / Column */}
      <rect
        x="130"
        y="110"
        width="36"
        height="36"
        rx="3"
        fill="rgb(var(--c-panel2))"
        stroke="rgb(var(--c-ink) / 0.7)"
        strokeWidth="2"
      />
      <line x1="130" y1="110" x2="166" y2="146" stroke="rgb(var(--c-line2))" strokeWidth="1.5" />
      <line x1="166" y1="110" x2="130" y2="146" stroke="rgb(var(--c-line2))" strokeWidth="1.5" />

      <rect
        x="290"
        y="100"
        width="40"
        height="50"
        rx="3"
        fill="rgb(var(--c-panel2))"
        stroke="rgb(var(--c-ink) / 0.7)"
        strokeWidth="2"
      />

      {/* Planned Trajectory Path (RRT* / Dubins in Teal) */}
      <path
        d="M 120 290 L 180 290 Q 220 290, 220 250 L 220 170 Q 220 140, 260 140 L 320 140 Q 360 140, 380 150 L 440 150 Q 480 150, 480 210 L 480 250"
        stroke="rgb(var(--c-telemetry))"
        strokeWidth="2.5"
        strokeDasharray="5 4"
      />

      {/* Trajectory Waypoints */}
      <circle cx="180" cy="290" r="3" fill="rgb(var(--c-telemetry))" />
      <circle cx="220" cy="170" r="3" fill="rgb(var(--c-telemetry))" />
      <circle cx="320" cy="140" r="3" fill="rgb(var(--c-telemetry))" />
      <circle cx="440" cy="150" r="3" fill="rgb(var(--c-telemetry))" />

      {/* Rover Location (Bottom Left Room) */}
      <g transform="translate(120, 290)">
        {/* Footprint / Heading */}
        <circle cx="0" cy="0" r="16" fill="rgb(var(--c-panel))" stroke="rgb(var(--c-ink))" strokeWidth="2" />
        <rect x="-14" y="-12" width="6" height="24" rx="2" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-ink))" strokeWidth="1.5" />
        <rect x="8" y="-12" width="6" height="24" rx="2" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-ink))" strokeWidth="1.5" />
        <circle cx="0" cy="0" r="4" fill="rgb(var(--c-telemetry))" />
        {/* Direction Heading Pointer */}
        <line x1="0" y1="0" x2="16" y2="0" stroke="rgb(var(--c-telemetry))" strokeWidth="2" />
        <circle cx="16" cy="0" r="2" fill="rgb(var(--c-telemetry))" />
      </g>

      {/* Fire Origin / Target (Right Hallway Bottom) */}
      <g transform="translate(480, 250)">
        {/* Thermal Radiation Hazard Zone */}
        <circle cx="0" cy="0" r="32" fill="rgb(var(--c-flame) / 0.12)" stroke="rgb(var(--c-flame) / 0.3)" strokeWidth="1.5" strokeDasharray="4 4" />
        <circle cx="0" cy="0" r="18" fill="rgb(var(--c-flame) / 0.22)" />
        {/* Fire Glyph */}
        <path
          d="M 0 -14 C -6 -6 -10 2 -10 8 C -10 14 -5 16 0 16 C 5 16 10 14 10 8 C 10 2 6 -6 0 -14 Z"
          fill="rgb(var(--c-flame))"
          stroke="rgb(var(--c-ink))"
          strokeWidth="1.5"
        />
        <circle cx="0" cy="6" r="3" fill="rgb(var(--c-panel))" />
      </g>
    </svg>
  );
}
