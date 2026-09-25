/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Same operator-console structure as before (dense telemetry, ANSI-style
        // signal colors), re-skinned in a warm dark register — deep teal-black
        // enclosure instead of brushed-aluminum light, glowing signal colors
        // instead of flat print-safety ones. Still one job: read fast, trust it.
        base: "#0A1A1C",         // app shell, deep teal-black
        panel: "#0E2429",        // card / instrument surface
        panel2: "#143036",       // hover / secondary surface
        line: "rgba(251,247,238,0.10)",  // hairline dividers on dark
        ink: "#F7F3E8",          // primary text, warm paper
        muted: "rgba(247,243,232,0.60)", // secondary text
        faint: "rgba(247,243,232,0.36)", // tertiary / placeholder text
        alarm: "#F0604A",        // coral — danger, E-STOP only
        warn: "#F4B942",         // gold — caution/alarm states
        telemetry: "#2FB8A6",    // mint — data, active state
        ok: "#5FE3B0",           // brighter mint-green — nominal/success
        scope: "#050807",        // camera/video viewport black (always dark)
      },
      fontFamily: {
        sans: ["Sora", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
        display: ['"Baloo 2"', "ui-rounded", "system-ui", "sans-serif"],
      },
      boxShadow: {
        panel: "0 1px 2px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)",
      },
    },
  },
  plugins: [],
};
