/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Mission-control register: a true-black instrument shell, not a warm dark theme.
        // Multiple accent hues are semantic, not decorative — signal/caution/alarm map to
        // exactly the three states a flight console needs an operator to tell apart at a
        // glance, the same convention real telemetry displays use.
        base: "#050607",         // app shell, true black
        panel: "#0A0D10",        // instrument surface
        panel2: "#12171B",       // hover / secondary surface
        line: "rgba(232,236,239,0.10)",  // hairline dividers
        ink: "#E8ECEF",          // primary text, cool white
        muted: "rgba(232,236,239,0.58)", // secondary text
        faint: "rgba(232,236,239,0.34)", // tertiary / placeholder text
        alarm: "#FC3D21",        // NASA insignia red — E-STOP / critical only
        warn: "#FFB000",         // amber — caution states
        telemetry: "#4AC7EC",    // signal cyan — live data, active state
        ok: "#20D48A",           // nominal / success green
        scope: "#000000",        // camera/video viewport, always true black
      },
      fontFamily: {
        sans: ["\"Public Sans\"", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
        display: ["\"Public Sans\"", "system-ui", "sans-serif"],
      },
      boxShadow: {
        panel: "0 1px 2px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.03)",
      },
      borderRadius: {
        DEFAULT: "3px",
      },
    },
  },
  plugins: [],
};
