import React from "react";

export default function NoSignal({ className = "", title = "Rover with no telemetry signal" }) {
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
      {/* Ground Line */}
      <line x1="50" y1="240" x2="350" y2="240" stroke="rgb(var(--c-line2))" strokeWidth="1.5" />
      <line x1="100" y1="248" x2="300" y2="248" stroke="rgb(var(--c-line))" strokeWidth="1" strokeDasharray="4 4" />

      {/* Disconnected / Interrupted Signal Arcs */}
      <path
        d="M 175 75 A 40 40 0 0 1 215 75"
        stroke="rgb(var(--c-faint))"
        strokeWidth="2"
        strokeDasharray="4 4"
      />
      <path
        d="M 160 55 A 65 65 0 0 1 230 55"
        stroke="rgb(var(--c-line2))"
        strokeWidth="2"
        strokeDasharray="4 4"
      />
      <path
        d="M 145 35 A 90 90 0 0 1 245 35"
        stroke="rgb(var(--c-line))"
        strokeWidth="1.5"
        strokeDasharray="3 5"
      />

      {/* Signal Break / Disconnect "×" Symbol */}
      <g transform="translate(195, 55)">
        <circle cx="0" cy="0" r="10" fill="rgb(var(--c-panel))" stroke="rgb(var(--c-line2))" strokeWidth="1.5" />
        <line x1="-4" y1="-4" x2="4" y2="4" stroke="rgb(var(--c-muted))" strokeWidth="1.75" />
        <line x1="4" y1="-4" x2="-4" y2="4" stroke="rgb(var(--c-muted))" strokeWidth="1.75" />
      </g>

      {/* --- ROVER BODY --- */}
      {/* Background Track */}
      <rect
        x="95"
        y="195"
        width="110"
        height="32"
        rx="16"
        fill="rgb(var(--c-panel2))"
        stroke="rgb(var(--c-ink) / 0.5)"
        strokeWidth="1.5"
      />

      {/* Main Hull */}
      <path
        d="M 110 200 L 120 150 L 235 150 L 265 190 L 255 210 L 120 210 Z"
        fill="rgb(var(--c-panel))"
        stroke="rgb(var(--c-ink) / 0.8)"
        strokeWidth="1.75"
      />

      {/* Body Recess */}
      <path
        d="M 130 158 L 225 158 L 250 190 L 135 190 Z"
        fill="rgb(var(--c-panel2))"
        stroke="rgb(var(--c-line2))"
        strokeWidth="1"
      />

      {/* Thermal Mast & Antenna Stem */}
      <line x1="185" y1="150" x2="185" y2="105" stroke="rgb(var(--c-ink) / 0.8)" strokeWidth="2" />
      <line x1="195" y1="150" x2="195" y2="85" stroke="rgb(var(--c-muted))" strokeWidth="1.5" />
      {/* Antenna Dipole Tip */}
      <circle cx="195" cy="85" r="3" fill="rgb(var(--c-panel))" stroke="rgb(var(--c-muted))" strokeWidth="1.5" />

      {/* Mast Thermal Pod */}
      <rect
        x="172"
        y="96"
        width="24"
        height="16"
        rx="3"
        fill="rgb(var(--c-panel))"
        stroke="rgb(var(--c-ink) / 0.8)"
        strokeWidth="1.5"
      />
      <circle cx="190" cy="104" r="4" fill="rgb(var(--c-faint))" stroke="rgb(var(--c-ink) / 0.7)" strokeWidth="1" />

      {/* Flame Sensors on Nose */}
      <circle cx="254" cy="180" r="2.5" fill="rgb(var(--c-faint))" stroke="rgb(var(--c-ink) / 0.6)" strokeWidth="1" />
      <circle cx="260" cy="186" r="2.5" fill="rgb(var(--c-faint))" stroke="rgb(var(--c-ink) / 0.6)" strokeWidth="1" />

      {/* Nozzle Turret */}
      <path
        d="M 230 150 L 260 146 L 280 151 L 240 157 Z"
        fill="rgb(var(--c-panel2))"
        stroke="rgb(var(--c-ink) / 0.8)"
        strokeWidth="1.5"
      />
      <rect x="280" y="148" width="12" height="6" rx="1" fill="rgb(var(--c-muted))" />

      {/* Foreground Track */}
      <g>
        <rect
          x="115"
          y="204"
          width="150"
          height="38"
          rx="19"
          fill="rgb(var(--c-panel2))"
          stroke="rgb(var(--c-ink) / 0.85)"
          strokeWidth="1.75"
        />
        <rect
          x="126"
          y="211"
          width="128"
          height="24"
          rx="12"
          fill="rgb(var(--c-panel))"
          stroke="rgb(var(--c-line2))"
          strokeWidth="1"
        />
        {/* Bogie Wheels */}
        <circle cx="140" cy="223" r="8" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-ink) / 0.7)" strokeWidth="1.25" />
        <circle cx="168" cy="223" r="8" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-ink) / 0.7)" strokeWidth="1.25" />
        <circle cx="196" cy="223" r="8" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-ink) / 0.7)" strokeWidth="1.25" />
        <circle cx="224" cy="223" r="8" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-ink) / 0.7)" strokeWidth="1.25" />
        <circle cx="248" cy="223" r="8" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-ink) / 0.7)" strokeWidth="1.25" />
      </g>
    </svg>
  );
}
