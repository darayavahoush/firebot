import React from "react";

export default function Architecture({ className = "", title = "System architecture diagram: Sensors, Estimator, Planner, Actuators" }) {
  return (
    <svg
      viewBox="0 0 640 360"
      className={className}
      role="img"
      aria-label={title}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Subtle Horizontal System Backbone Bus Line */}
      <line x1="60" y1="180" x2="580" y2="180" stroke="rgb(var(--c-line))" strokeWidth="1" strokeDasharray="4 4" />

      {/* --- BLOCK 1: SENSORS (x: 50, y: 110, w: 100, h: 140) --- */}
      <g>
        <rect
          x="50"
          y="110"
          width="100"
          height="140"
          rx="10"
          fill="rgb(var(--c-panel))"
          stroke="rgb(var(--c-ink) / 0.85)"
          strokeWidth="2"
        />
        <rect
          x="60"
          y="120"
          width="80"
          height="32"
          rx="6"
          fill="rgb(var(--c-panel2))"
          stroke="rgb(var(--c-line2))"
          strokeWidth="1.25"
        />
        {/* Sensor Glyph: Thermal Sensor Wave + Tri-Photodiode */}
        <path
          d="M 75 136 Q 85 128, 95 136 T 115 136"
          stroke="rgb(var(--c-flame))"
          strokeWidth="2"
        />
        {/* Photodiode Eye / Sonar Arc */}
        <circle cx="100" cy="190" r="18" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-ink) / 0.7)" strokeWidth="1.5" />
        <circle cx="100" cy="190" r="8" fill="rgb(var(--c-telemetry))" />
        <path d="M 86 172 A 24 24 0 0 1 114 172" stroke="rgb(var(--c-line2))" strokeWidth="1.5" strokeDasharray="2 3" />
        <path d="M 80 164 A 32 32 0 0 1 120 164" stroke="rgb(var(--c-line))" strokeWidth="1.5" strokeDasharray="3 3" />
      </g>

      {/* Connecting Arrow 1 -> 2 (Sensors to Estimator) */}
      <g stroke="rgb(var(--c-telemetry))" strokeWidth="2">
        <line x1="150" y1="180" x2="198" y2="180" />
        <path d="M 192 174 L 200 180 L 192 186" fill="none" />
      </g>

      {/* --- BLOCK 2: ESTIMATOR (x: 202, y: 110, w: 100, h: 140) --- */}
      <g>
        <rect
          x="202"
          y="110"
          width="100"
          height="140"
          rx="10"
          fill="rgb(var(--c-panel))"
          stroke="rgb(var(--c-ink) / 0.85)"
          strokeWidth="2"
        />
        <rect
          x="212"
          y="120"
          width="80"
          height="32"
          rx="6"
          fill="rgb(var(--c-panel2))"
          stroke="rgb(var(--c-line2))"
          strokeWidth="1.25"
        />
        {/* Estimator Glyph: Matrix Covariance Grid / Information Filter */}
        <line x1="230" y1="130" x2="274" y2="130" stroke="rgb(var(--c-line2))" strokeWidth="1.5" />
        <line x1="230" y1="136" x2="274" y2="136" stroke="rgb(var(--c-line2))" strokeWidth="1.5" />
        <line x1="230" y1="142" x2="260" y2="142" stroke="rgb(var(--c-line2))" strokeWidth="1.5" />

        {/* Gaussian Uncertainty Ellipses */}
        <ellipse
          cx="252"
          cy="190"
          rx="26"
          ry="15"
          fill="rgb(var(--c-telemetry) / 0.12)"
          stroke="rgb(var(--c-telemetry))"
          strokeWidth="1.5"
          transform="rotate(-20 252 190)"
        />
        <ellipse
          cx="252"
          cy="190"
          rx="14"
          ry="8"
          stroke="rgb(var(--c-telemetry))"
          strokeWidth="1.5"
          transform="rotate(-20 252 190)"
        />
        <circle cx="252" cy="190" r="3" fill="rgb(var(--c-flame))" />
      </g>

      {/* Connecting Arrow 2 -> 3 (Estimator to Planner) */}
      <g stroke="rgb(var(--c-telemetry))" strokeWidth="2">
        <line x1="302" y1="180" x2="350" y2="180" />
        <path d="M 344 174 L 352 180 L 344 186" fill="none" />
      </g>

      {/* --- BLOCK 3: PLANNER (x: 354, y: 110, w: 100, h: 140) --- */}
      <g>
        <rect
          x="354"
          y="110"
          width="100"
          height="140"
          rx="10"
          fill="rgb(var(--c-panel))"
          stroke="rgb(var(--c-ink) / 0.85)"
          strokeWidth="2"
        />
        <rect
          x="364"
          y="120"
          width="80"
          height="32"
          rx="6"
          fill="rgb(var(--c-panel2))"
          stroke="rgb(var(--c-line2))"
          strokeWidth="1.25"
        />
        <circle cx="380" cy="136" r="3" fill="rgb(var(--c-telemetry))" />
        <circle cx="404" cy="136" r="3" fill="rgb(var(--c-line2))" />
        <circle cx="428" cy="136" r="3" fill="rgb(var(--c-line2))" />

        {/* Planner Glyph: RRT* Branching Tree & Path Graph */}
        {/* Trunk & Branches */}
        <line x1="375" y1="215" x2="395" y2="190" stroke="rgb(var(--c-ink) / 0.4)" strokeWidth="1.5" />
        <line x1="395" y1="190" x2="385" y2="165" stroke="rgb(var(--c-ink) / 0.4)" strokeWidth="1.5" />
        <line x1="395" y1="190" x2="425" y2="180" stroke="rgb(var(--c-telemetry))" strokeWidth="2" />
        <line x1="425" y1="180" x2="435" y2="165" stroke="rgb(var(--c-telemetry))" strokeWidth="2" />
        <line x1="395" y1="190" x2="415" y2="215" stroke="rgb(var(--c-ink) / 0.4)" strokeWidth="1.5" />

        {/* Nodes */}
        <circle cx="375" cy="215" r="3" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-ink) / 0.7)" strokeWidth="1.5" />
        <circle cx="395" cy="190" r="3.5" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-ink))" strokeWidth="1.5" />
        <circle cx="385" cy="165" r="3" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-ink) / 0.7)" strokeWidth="1.5" />
        <circle cx="415" cy="215" r="3" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-ink) / 0.7)" strokeWidth="1.5" />
        <circle cx="425" cy="180" r="3.5" fill="rgb(var(--c-telemetry))" />
        <circle cx="435" cy="165" r="4" fill="rgb(var(--c-flame))" />
      </g>

      {/* Connecting Arrow 3 -> 4 (Planner to Actuators) */}
      <g stroke="rgb(var(--c-telemetry))" strokeWidth="2">
        <line x1="454" y1="180" x2="502" y2="180" />
        <path d="M 496 174 L 504 180 L 496 186" fill="none" />
      </g>

      {/* --- BLOCK 4: ACTUATORS (x: 506, y: 110, w: 100, h: 140) --- */}
      <g>
        <rect
          x="506"
          y="110"
          width="100"
          height="140"
          rx="10"
          fill="rgb(var(--c-panel))"
          stroke="rgb(var(--c-ink) / 0.85)"
          strokeWidth="2"
        />
        <rect
          x="516"
          y="120"
          width="80"
          height="32"
          rx="6"
          fill="rgb(var(--c-panel2))"
          stroke="rgb(var(--c-line2))"
          strokeWidth="1.25"
        />
        {/* Actuator Motor Cogs & Spray Nozzle */}
        <circle cx="556" cy="136" r="6" fill="rgb(var(--c-panel))" stroke="rgb(var(--c-line2))" strokeWidth="1.5" />

        {/* Gear Wheels */}
        <circle cx="546" cy="180" r="14" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-ink) / 0.8)" strokeWidth="1.5" />
        <circle cx="546" cy="180" r="5" fill="rgb(var(--c-panel))" stroke="rgb(var(--c-ink) / 0.7)" strokeWidth="1.5" />

        <circle cx="566" cy="198" r="11" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-ink) / 0.8)" strokeWidth="1.5" />
        <circle cx="566" cy="198" r="4" fill="rgb(var(--c-panel))" stroke="rgb(var(--c-ink) / 0.7)" strokeWidth="1.5" />

        {/* High-Pressure Spray Nozzle Droplet */}
        <path
          d="M 534 220 L 550 220 L 542 232 Z"
          fill="rgb(var(--c-flame))"
          stroke="rgb(var(--c-ink) / 0.85)"
          strokeWidth="1.5"
        />
        <circle cx="542" cy="238" r="2" fill="rgb(var(--c-telemetry))" />
        <circle cx="542" cy="244" r="1.5" fill="rgb(var(--c-telemetry))" />
      </g>

      {/* Closed Feedback Loop Return Path (Actuators back to Sensors) */}
      <path
        d="M 556 250 L 556 295 L 100 295 L 100 250"
        stroke="rgb(var(--c-line2))"
        strokeWidth="1.5"
        strokeDasharray="4 4"
      />
      <path
        d="M 104 256 L 100 248 L 96 256"
        stroke="rgb(var(--c-line2))"
        strokeWidth="1.5"
        fill="none"
      />
    </svg>
  );
}
