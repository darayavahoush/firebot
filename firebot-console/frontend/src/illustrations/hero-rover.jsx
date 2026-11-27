import React from "react";

export default function HeroRover({ className = "", title = "Firebot tracked firefighting rover" }) {
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
      {/* Background Soft Flame Silhouette */}
      <path
        d="M 440 290 C 420 250 435 210 460 170 C 475 145 470 120 455 95 C 490 125 515 165 515 215 C 515 228 510 240 500 250 C 515 235 530 220 535 195 C 550 230 545 265 525 290 Z"
        fill="rgb(var(--c-flame) / 0.08)"
        stroke="rgb(var(--c-flame) / 0.25)"
        strokeWidth="1.5"
      />
      <path
        d="M 460 290 C 448 268 455 242 472 220 C 482 205 480 188 472 172 C 495 192 508 220 505 252 C 498 272 482 285 460 290 Z"
        fill="rgb(var(--c-flame) / 0.14)"
      />

      {/* Ground Horizon / Floor Lines */}
      <line x1="40" y1="315" x2="600" y2="315" stroke="rgb(var(--c-line2))" strokeWidth="2" />
      <line x1="120" y1="330" x2="520" y2="330" stroke="rgb(var(--c-line))" strokeWidth="1" strokeDasharray="6 6" />

      {/* Thermal Mast Sensor Arc (Sweep from Mast Pod) */}
      <path
        d="M 285 105 A 190 190 0 0 1 475 220"
        stroke="rgb(var(--c-telemetry))"
        strokeWidth="1.5"
        strokeDasharray="4 4"
      />
      <path
        d="M 285 105 A 250 250 0 0 1 535 255"
        stroke="rgb(var(--c-telemetry) / 0.45)"
        strokeWidth="1.5"
        strokeDasharray="3 5"
      />
      <circle cx="475" cy="220" r="3" fill="rgb(var(--c-telemetry))" />
      <circle cx="535" cy="255" r="3" fill="rgb(var(--c-telemetry))" />

      {/* --- ROVER BODY (3/4 Side-Front View) --- */}

      {/* Left/Rear Track Assembly (Shadowed) */}
      <rect
        x="135"
        y="250"
        width="170"
        height="45"
        rx="22"
        fill="rgb(var(--c-panel2))"
        stroke="rgb(var(--c-ink) / 0.7)"
        strokeWidth="2"
      />

      {/* Main Chassis Hull */}
      <path
        d="M 160 255 L 175 185 L 340 185 L 385 240 L 375 270 L 175 270 Z"
        fill="rgb(var(--c-panel))"
        stroke="rgb(var(--c-ink))"
        strokeWidth="2"
      />

      {/* Chassis Armor Bevel / Detail */}
      <path
        d="M 190 195 L 330 195 L 365 240 L 195 240 Z"
        fill="rgb(var(--c-panel2))"
        stroke="rgb(var(--c-line2))"
        strokeWidth="1.5"
      />

      {/* Equipment Bay / Dual Compute Hatch */}
      <rect
        x="210"
        y="202"
        width="95"
        height="30"
        rx="4"
        fill="rgb(var(--c-panel))"
        stroke="rgb(var(--c-line2))"
        strokeWidth="1.5"
      />
      <circle cx="225" cy="217" r="3" fill="rgb(var(--c-telemetry))" />
      <line x1="236" y1="214" x2="290" y2="214" stroke="rgb(var(--c-ink) / 0.4)" strokeWidth="1.5" />
      <line x1="236" y1="220" x2="275" y2="220" stroke="rgb(var(--c-ink) / 0.3)" strokeWidth="1.5" />

      {/* Thermal Mast (Rises from Hull) */}
      <line x1="260" y1="185" x2="260" y2="120" stroke="rgb(var(--c-ink))" strokeWidth="3" />
      <line x1="270" y1="185" x2="270" y2="120" stroke="rgb(var(--c-ink))" strokeWidth="2" />
      <rect
        x="252"
        y="145"
        width="26"
        height="6"
        rx="2"
        fill="rgb(var(--c-panel2))"
        stroke="rgb(var(--c-ink))"
        strokeWidth="1.5"
      />

      {/* Pan-Tilt Mast Head */}
      <circle cx="265" cy="118" r="8" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-ink))" strokeWidth="2" />
      {/* FLIR MLX90640 Thermal Sensor Pod */}
      <rect
        x="262"
        y="96"
        width="34"
        height="22"
        rx="5"
        fill="rgb(var(--c-panel))"
        stroke="rgb(var(--c-ink))"
        strokeWidth="2"
      />
      {/* Germanium Lens */}
      <circle cx="288" cy="107" r="6" fill="rgb(var(--c-telemetry))" stroke="rgb(var(--c-ink))" strokeWidth="1.5" />
      <circle cx="288" cy="107" r="2.5" fill="rgb(var(--c-panel))" />

      {/* Tri-Zone Flame Photodiode Array on Nose */}
      <g>
        <circle cx="368" cy="226" r="3.5" fill="rgb(var(--c-flame))" stroke="rgb(var(--c-ink))" strokeWidth="1" />
        <circle cx="376" cy="235" r="3.5" fill="rgb(var(--c-flame))" stroke="rgb(var(--c-ink))" strokeWidth="1" />
        <circle cx="384" cy="244" r="3.5" fill="rgb(var(--c-flame))" stroke="rgb(var(--c-ink))" strokeWidth="1" />
      </g>

      {/* High-Pressure Suppression Turret & Nozzle */}
      <path
        d="M 335 185 L 375 178 L 410 184 L 415 192 L 350 196 Z"
        fill="rgb(var(--c-flame))"
        stroke="rgb(var(--c-ink))"
        strokeWidth="2"
      />
      <rect
        x="410"
        y="180"
        width="24"
        height="10"
        rx="2"
        fill="rgb(var(--c-ink))"
        stroke="rgb(var(--c-ink))"
        strokeWidth="1"
      />
      {/* Water Atomization Orifice */}
      <line x1="434" y1="181" x2="434" y2="189" stroke="rgb(var(--c-telemetry))" strokeWidth="2.5" />

      {/* Front / Main Track Assembly (Foreground) */}
      <g>
        {/* Track Belt Outer */}
        <rect
          x="170"
          y="262"
          width="215"
          height="54"
          rx="27"
          fill="rgb(var(--c-panel2))"
          stroke="rgb(var(--c-ink))"
          strokeWidth="2"
        />
        {/* Track Tread Inner Recess */}
        <rect
          x="184"
          y="272"
          width="187"
          height="34"
          rx="17"
          fill="rgb(var(--c-panel))"
          stroke="rgb(var(--c-line2))"
          strokeWidth="1.5"
        />
        {/* Road Wheels (Tandem Bogies) */}
        <circle cx="204" cy="289" r="12" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-ink))" strokeWidth="1.5" />
        <circle cx="204" cy="289" r="4" fill="rgb(var(--c-ink) / 0.5)" />

        <circle cx="242" cy="289" r="12" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-ink))" strokeWidth="1.5" />
        <circle cx="242" cy="289" r="4" fill="rgb(var(--c-ink) / 0.5)" />

        <circle cx="280" cy="289" r="12" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-ink))" strokeWidth="1.5" />
        <circle cx="280" cy="289" r="4" fill="rgb(var(--c-ink) / 0.5)" />

        <circle cx="318" cy="289" r="12" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-ink))" strokeWidth="1.5" />
        <circle cx="318" cy="289" r="4" fill="rgb(var(--c-ink) / 0.5)" />

        <circle cx="354" cy="289" r="12" fill="rgb(var(--c-panel2))" stroke="rgb(var(--c-ink))" strokeWidth="1.5" />
        <circle cx="354" cy="289" r="4" fill="rgb(var(--c-ink) / 0.5)" />

        {/* Outer Tread Grousers */}
        <line x1="200" y1="262" x2="200" y2="267" stroke="rgb(var(--c-ink))" strokeWidth="2" />
        <line x1="230" y1="262" x2="230" y2="267" stroke="rgb(var(--c-ink))" strokeWidth="2" />
        <line x1="260" y1="262" x2="260" y2="267" stroke="rgb(var(--c-ink))" strokeWidth="2" />
        <line x1="290" y1="262" x2="290" y2="267" stroke="rgb(var(--c-ink))" strokeWidth="2" />
        <line x1="320" y1="262" x2="320" y2="267" stroke="rgb(var(--c-ink))" strokeWidth="2" />
        <line x1="350" y1="262" x2="350" y2="267" stroke="rgb(var(--c-ink))" strokeWidth="2" />

        <line x1="200" y1="311" x2="200" y2="316" stroke="rgb(var(--c-ink))" strokeWidth="2" />
        <line x1="230" y1="311" x2="230" y2="316" stroke="rgb(var(--c-ink))" strokeWidth="2" />
        <line x1="260" y1="311" x2="260" y2="316" stroke="rgb(var(--c-ink))" strokeWidth="2" />
        <line x1="290" y1="311" x2="290" y2="316" stroke="rgb(var(--c-ink))" strokeWidth="2" />
        <line x1="320" y1="311" x2="320" y2="316" stroke="rgb(var(--c-ink))" strokeWidth="2" />
        <line x1="350" y1="311" x2="350" y2="316" stroke="rgb(var(--c-ink))" strokeWidth="2" />
      </g>
    </svg>
  );
}
