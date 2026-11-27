import React from "react";

export default function ErrorGeneric({ className = "", title = "Something went wrong" }) {
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
      {/* Uneven / Tipped Floor Incline */}
      <line x1="40" y1="235" x2="360" y2="255" stroke="rgb(var(--c-line2))" strokeWidth="2" />
      <line x1="80" y1="248" x2="320" y2="263" stroke="rgb(var(--c-line))" strokeWidth="1" strokeDasharray="4 4" />

      {/* Small Rock Obstacle causing Tip */}
      <polygon
        points="175,244 195,235 210,246"
        fill="rgb(var(--c-panel2))"
        stroke="rgb(var(--c-ink) / 0.7)"
        strokeWidth="1.5"
      />

      {/* Warning Triangle Indicator Floating Top Right */}
      <g transform="translate(255, 65)">
        <polygon
          points="0,-25 24,18 -24,18"
          fill="rgb(var(--c-panel))"
          stroke="rgb(var(--c-flame))"
          strokeWidth="2"
        />
        {/* Exclamation Point Mark */}
        <line x1="0" y1="-10" x2="0" y2="4" stroke="rgb(var(--c-flame))" strokeWidth="2.5" />
        <circle cx="0" cy="11" r="1.5" fill="rgb(var(--c-flame))" />
      </g>

      {/* --- TIPPED ROVER (Rotated 10 degrees) --- */}
      <g transform="translate(180, 200) rotate(11)">
        {/* Background Track */}
        <rect
          x="-95"
          y="15"
          width="130"
          height="32"
          rx="16"
          fill="rgb(var(--c-panel2))"
          stroke="rgb(var(--c-ink) / 0.6)"
          strokeWidth="1.5"
        />

        {/* Rover Hull */}
        <path
          d="M -80 20 L -65 -35 L 50 -35 L 80 10 L 70 30 L -70 30 Z"
          fill="rgb(var(--c-panel))"
          stroke="rgb(var(--c-ink) / 0.85)"
          strokeWidth="2"
        />

        {/* Chassis Armor Bevel */}
        <path
          d="M -50 -25 L 40 -25 L 65 10 L -40 10 Z"
          fill="rgb(var(--c-panel2))"
          stroke="rgb(var(--c-line2))"
          strokeWidth="1.25"
        />

        {/* Thermal Mast */}
        <line x1="0" y1="-35" x2="0" y2="-85" stroke="rgb(var(--c-ink))" strokeWidth="2" />
        <rect
          x="-14"
          y="-92"
          width="24"
          height="16"
          rx="3"
          fill="rgb(var(--c-panel))"
          stroke="rgb(var(--c-ink))"
          strokeWidth="1.5"
        />
        <circle cx="4" cy="-84" r="4" fill="rgb(var(--c-faint))" stroke="rgb(var(--c-ink))" strokeWidth="1" />

        {/* Flame sensor dots */}
        <circle cx="68" cy="2" r="2.5" fill="rgb(var(--c-flame))" />
        <circle cx="74" cy="8" r="2.5" fill="rgb(var(--c-flame))" />

        {/* Front Nozzle Turret */}
        <path
          d="M 45 -35 L 75 -40 L 92 -35 L 55 -28 Z"
          fill="rgb(var(--c-panel2))"
          stroke="rgb(var(--c-ink))"
          strokeWidth="1.5"
        />

        {/* Foreground Track Assembly */}
        <rect
          x="-75"
          y="25"
          width="155"
          height="38"
          rx="19"
          fill="rgb(var(--c-panel2))"
          stroke="rgb(var(--c-ink) / 0.85)"
          strokeWidth="2"
        />
        <rect
          x="-65"
          y="32"
          width="135"
          height="24"
          rx="12"
          fill="rgb(var(--c-panel))"
          stroke="rgb(var(--c-line2))"
          strokeWidth="1"
        />
        {/* Wheels */}
        <circle cx="-50" cy="44" r="7" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-ink) / 0.7)" strokeWidth="1.25" />
        <circle cx="-22" cy="44" r="7" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-ink) / 0.7)" strokeWidth="1.25" />
        <circle cx="6" cy="44" r="7" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-ink) / 0.7)" strokeWidth="1.25" />
        <circle cx="34" cy="44" r="7" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-ink) / 0.7)" strokeWidth="1.25" />
        <circle cx="58" cy="44" r="7" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-ink) / 0.7)" strokeWidth="1.25" />
      </g>
    </svg>
  );
}
