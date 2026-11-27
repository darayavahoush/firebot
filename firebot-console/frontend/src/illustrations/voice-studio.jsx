import React from "react";

export default function VoiceStudio({ className = "", title = "Operator voice studio and audio calibration" }) {
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
      {/* Soft Concentric Acoustic Wave Rings */}
      <circle
        cx="320"
        cy="180"
        r="140"
        stroke="rgb(var(--c-telemetry) / 0.12)"
        strokeWidth="1.5"
        strokeDasharray="6 6"
      />
      <circle
        cx="320"
        cy="180"
        r="100"
        stroke="rgb(var(--c-telemetry) / 0.22)"
        strokeWidth="1.5"
      />
      <circle
        cx="320"
        cy="180"
        r="68"
        fill="rgb(var(--c-panel2))"
        stroke="rgb(var(--c-telemetry) / 0.35)"
        strokeWidth="1.5"
      />

      {/* Symmetric Soundwave Graphic (Left & Right Flanks) */}
      <g stroke="rgb(var(--c-telemetry))" strokeWidth="2.5">
        {/* Left Waveform Bars */}
        <line x1="80" y1="180" x2="80" y2="180" strokeWidth="3" />
        <line x1="105" y1="172" x2="105" y2="188" />
        <line x1="130" y1="160" x2="130" y2="200" />
        <line x1="155" y1="140" x2="155" y2="220" />
        <line x1="180" y1="165" x2="180" y2="195" />
        <line x1="205" y1="125" x2="205" y2="235" strokeWidth="3" />
        <line x1="230" y1="150" x2="230" y2="210" />
        <line x1="255" y1="170" x2="255" y2="190" />

        {/* Right Waveform Bars (Symmetric) */}
        <line x1="385" y1="170" x2="385" y2="190" />
        <line x1="410" y1="150" x2="410" y2="210" />
        <line x1="435" y1="125" x2="435" y2="235" strokeWidth="3" />
        <line x1="460" y1="165" x2="460" y2="195" />
        <line x1="485" y1="140" x2="485" y2="220" />
        <line x1="510" y1="160" x2="510" y2="200" />
        <line x1="535" y1="172" x2="535" y2="188" />
        <line x1="560" y1="180" x2="560" y2="180" strokeWidth="3" />
      </g>

      {/* Studio Condenser Microphone (Center Foreground) */}
      {/* Shock Mount / Outer Ring */}
      <circle
        cx="320"
        cy="170"
        r="44"
        fill="rgb(var(--c-panel))"
        stroke="rgb(var(--c-ink) / 0.85)"
        strokeWidth="2"
      />
      {/* Elastic Suspension Bands */}
      <line x1="290" y1="140" x2="305" y2="155" stroke="rgb(var(--c-line2))" strokeWidth="1.5" />
      <line x1="350" y1="140" x2="335" y2="155" stroke="rgb(var(--c-line2))" strokeWidth="1.5" />
      <line x1="290" y1="200" x2="305" y2="185" stroke="rgb(var(--c-line2))" strokeWidth="1.5" />
      <line x1="350" y1="200" x2="335" y2="185" stroke="rgb(var(--c-line2))" strokeWidth="1.5" />

      {/* Microphone Capsule Body */}
      <rect
        x="305"
        y="130"
        width="30"
        height="64"
        rx="15"
        fill="rgb(var(--c-panel2))"
        stroke="rgb(var(--c-ink))"
        strokeWidth="2"
      />

      {/* Grille Mesh Texture */}
      <rect
        x="305"
        y="130"
        width="30"
        height="32"
        rx="15"
        fill="rgb(var(--c-panel))"
        stroke="rgb(var(--c-ink))"
        strokeWidth="2"
      />
      <line x1="310" y1="146" x2="330" y2="146" stroke="rgb(var(--c-line2))" strokeWidth="1.5" />
      <line x1="312" y1="154" x2="328" y2="154" stroke="rgb(var(--c-line2))" strokeWidth="1.5" />

      {/* Mic Status LED Indicator (Hero Accent: Flame) */}
      <circle cx="320" cy="176" r="3" fill="rgb(var(--c-flame))" />

      {/* Stand Swivel Joint & Shaft */}
      <rect
        x="315"
        y="214"
        width="10"
        height="18"
        rx="2"
        fill="rgb(var(--c-panel))"
        stroke="rgb(var(--c-ink))"
        strokeWidth="2"
      />
      <line x1="320" y1="232" x2="320" y2="330" stroke="rgb(var(--c-ink))" strokeWidth="3" />

      {/* Desk Stand Base */}
      <path
        d="M 260 330 C 260 322, 380 322, 380 330 L 390 338 L 250 338 Z"
        fill="rgb(var(--c-panel2))"
        stroke="rgb(var(--c-ink))"
        strokeWidth="2"
      />
      <line x1="200" y1="338" x2="440" y2="338" stroke="rgb(var(--c-line2))" strokeWidth="2" />
    </svg>
  );
}
