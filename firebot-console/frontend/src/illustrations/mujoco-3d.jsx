import React from "react";

export default function Mujoco3D({ className = "", title = "MuJoCo 3D physics simulation with lidar sweep" }) {
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
      {/* Isometric Grid Floor Plane */}
      <g stroke="rgb(var(--c-line))" strokeWidth="1" opacity="0.5">
        {/* Iso Axis lines 1 (top-left to bottom-right) */}
        <line x1="120" y1="120" x2="480" y2="330" />
        <line x1="180" y1="90" x2="540" y2="300" />
        <line x1="240" y1="60" x2="600" y2="270" />
        <line x1="60" y1="150" x2="420" y2="360" />

        {/* Iso Axis lines 2 (top-right to bottom-left) */}
        <line x1="520" y1="130" x2="160" y2="340" />
        <line x1="460" y1="100" x2="100" y2="310" />
        <line x1="580" y1="160" x2="220" y2="370" />
        <line x1="400" y1="70" x2="40" y2="280" />
      </g>

      {/* Isometric Obstacle Wall (Top-Right) */}
      <g>
        {/* Wall base: (430, 110) to (530, 170) */}
        <polygon
          points="430,110 530,170 530,90 430,30"
          fill="rgb(var(--c-panel2))"
          stroke="rgb(var(--c-ink) / 0.8)"
          strokeWidth="2"
        />
        <polygon
          points="430,110 390,135 390,55 430,30"
          fill="rgb(var(--c-panel))"
          stroke="rgb(var(--c-ink) / 0.8)"
          strokeWidth="2"
        />
        <polygon
          points="430,30 530,90 490,115 390,55"
          fill="rgb(var(--c-panel2) / 0.7)"
          stroke="rgb(var(--c-ink) / 0.8)"
          strokeWidth="1.5"
        />
      </g>

      {/* Lidar Ray Fan (Emanating from Rover Lidar Dome at 270, 205) */}
      <g stroke="rgb(var(--c-telemetry))" strokeWidth="1.25">
        <line x1="270" y1="205" x2="415" y2="95" strokeDasharray="3 3" />
        <circle cx="415" cy="95" r="2.5" fill="rgb(var(--c-telemetry))" />

        <line x1="270" y1="205" x2="445" y2="105" strokeDasharray="3 3" />
        <circle cx="445" cy="105" r="2.5" fill="rgb(var(--c-telemetry))" />

        <line x1="270" y1="205" x2="480" y2="125" strokeDasharray="3 3" />
        <circle cx="480" cy="125" r="2.5" fill="rgb(var(--c-telemetry))" />

        <line x1="270" y1="205" x2="510" y2="150" strokeDasharray="3 3" />
        <circle cx="510" cy="150" r="2.5" fill="rgb(var(--c-telemetry))" />

        <line x1="270" y1="205" x2="515" y2="185" opacity="0.6" strokeDasharray="4 4" />
        <line x1="270" y1="205" x2="490" y2="225" opacity="0.6" strokeDasharray="4 4" />
        <line x1="270" y1="205" x2="440" y2="265" opacity="0.6" strokeDasharray="4 4" />
        <line x1="270" y1="205" x2="360" y2="295" opacity="0.6" strokeDasharray="4 4" />
      </g>

      {/* Left Obstacle Pillar */}
      <polygon
        points="140,200 170,218 170,165 140,147"
        fill="rgb(var(--c-panel2))"
        stroke="rgb(var(--c-ink) / 0.7)"
        strokeWidth="1.75"
      />
      <polygon
        points="140,200 115,185 115,132 140,147"
        fill="rgb(var(--c-panel))"
        stroke="rgb(var(--c-ink) / 0.7)"
        strokeWidth="1.75"
      />
      <polygon
        points="140,147 170,165 145,180 115,162"
        fill="rgb(var(--c-panel2))"
        stroke="rgb(var(--c-ink) / 0.7)"
        strokeWidth="1.5"
      />

      {/* --- ISOMETRIC ROVER (Center Stage) --- */}
      {/* Far Track Assembly */}
      <polygon
        points="220,180 300,230 300,250 220,200"
        fill="rgb(var(--c-panel2))"
        stroke="rgb(var(--c-ink) / 0.6)"
        strokeWidth="1.5"
      />

      {/* Rover Main Chassis Hull (Isometric Prism) */}
      {/* Top Face */}
      <polygon
        points="230,200 310,155 350,180 270,225"
        fill="rgb(var(--c-panel))"
        stroke="rgb(var(--c-ink))"
        strokeWidth="2"
      />
      {/* Left Front Face */}
      <polygon
        points="270,225 350,180 350,210 270,255"
        fill="rgb(var(--c-panel2))"
        stroke="rgb(var(--c-ink))"
        strokeWidth="2"
      />
      {/* Right Front Face */}
      <polygon
        points="230,200 270,225 270,255 230,230"
        fill="rgb(var(--c-line2))"
        stroke="rgb(var(--c-ink))"
        strokeWidth="2"
      />

      {/* Front Suppression Nozzle */}
      <polygon
        points="340,185 375,205 375,215 340,195"
        fill="rgb(var(--c-flame))"
        stroke="rgb(var(--c-ink))"
        strokeWidth="1.75"
      />
      <circle cx="375" cy="210" r="3" fill="rgb(var(--c-telemetry))" stroke="rgb(var(--c-ink))" strokeWidth="1" />

      {/* Thermal Mast & Lidar Sensor Dome */}
      <line x1="285" y1="180" x2="285" y2="135" stroke="rgb(var(--c-ink))" strokeWidth="2.5" />
      {/* Lidar Rotating Head */}
      <ellipse
        cx="285"
        cy="135"
        rx="16"
        ry="9"
        fill="rgb(var(--c-panel2))"
        stroke="rgb(var(--c-ink))"
        strokeWidth="2"
      />
      <ellipse
        cx="285"
        cy="130"
        rx="10"
        ry="6"
        fill="rgb(var(--c-telemetry))"
        stroke="rgb(var(--c-ink))"
        strokeWidth="1.5"
      />

      {/* Near Track Assembly (Foreground) */}
      <g>
        <polygon
          points="200,225 275,270 275,295 200,250"
          fill="rgb(var(--c-panel2))"
          stroke="rgb(var(--c-ink))"
          strokeWidth="2"
        />
        {/* Track Wheels */}
        <circle cx="218" cy="245" r="7" fill="rgb(var(--c-panel))" stroke="rgb(var(--c-ink))" strokeWidth="1.5" />
        <circle cx="238" cy="257" r="7" fill="rgb(var(--c-panel))" stroke="rgb(var(--c-ink))" strokeWidth="1.5" />
        <circle cx="258" cy="269" r="7" fill="rgb(var(--c-panel))" stroke="rgb(var(--c-ink))" strokeWidth="1.5" />
      </g>
    </svg>
  );
}
