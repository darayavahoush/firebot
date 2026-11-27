import React from "react";

export default function EmptyLog({ className = "", title = "No commands in log" }) {
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
      {/* Background Secondary Bubble / Frame */}
      <rect
        x="80"
        y="50"
        width="220"
        height="140"
        rx="10"
        fill="rgb(var(--c-panel2))"
        stroke="rgb(var(--c-line2))"
        strokeWidth="1.5"
      />
      <line x1="105" y1="80" x2="160" y2="80" stroke="rgb(var(--c-line2))" strokeWidth="2" />
      <line x1="105" y1="100" x2="220" y2="100" stroke="rgb(var(--c-line))" strokeWidth="1.5" />
      <line x1="105" y1="120" x2="190" y2="120" stroke="rgb(var(--c-line))" strokeWidth="1.5" />

      {/* Main Foreground Terminal Console Box */}
      <rect
        x="100"
        y="95"
        width="220"
        height="150"
        rx="10"
        fill="rgb(var(--c-panel))"
        stroke="rgb(var(--c-ink) / 0.85)"
        strokeWidth="2"
      />

      {/* Terminal Title Bar */}
      <line x1="100" y1="125" x2="320" y2="125" stroke="rgb(var(--c-line2))" strokeWidth="1.5" />
      {/* Traffic Dots */}
      <circle cx="118" cy="110" r="3" fill="rgb(var(--c-flame))" />
      <circle cx="130" cy="110" r="3" fill="rgb(var(--c-muted) / 0.4)" />
      <circle cx="142" cy="110" r="3" fill="rgb(var(--c-muted) / 0.4)" />

      {/* Console Prompt Line */}
      {/* Command Prompt Chevron (>) */}
      <path
        d="M 125 152 L 133 158 L 125 164"
        stroke="rgb(var(--c-flame))"
        strokeWidth="2"
      />

      {/* Blinking Cursor Bar */}
      <line
        x1="142"
        y1="149"
        x2="142"
        y2="167"
        stroke="rgb(var(--c-telemetry))"
        strokeWidth="2.5"
      />

      {/* Ghost command line hint */}
      <line
        x1="154"
        y1="158"
        x2="230"
        y2="158"
        stroke="rgb(var(--c-faint))"
        strokeWidth="2"
        strokeDasharray="3 3"
      />

      {/* Subsequent idle lines */}
      <g opacity="0.35">
        <line x1="125" y1="184" x2="135" y2="184" stroke="rgb(var(--c-muted))" strokeWidth="1.5" />
        <line x1="145" y1="184" x2="250" y2="184" stroke="rgb(var(--c-muted))" strokeWidth="1.5" />

        <line x1="125" y1="206" x2="135" y2="206" stroke="rgb(var(--c-muted))" strokeWidth="1.5" />
        <line x1="145" y1="206" x2="210" y2="206" stroke="rgb(var(--c-muted))" strokeWidth="1.5" />
      </g>
    </svg>
  );
}
