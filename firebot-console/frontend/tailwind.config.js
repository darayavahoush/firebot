/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Grounded in real fire-apparatus pump panels and industrial HMI
        // screens (Siemens/ABB style) rather than a dark SaaS dashboard:
        // light brushed-enclosure base, ANSI-style safety accents.
        base: "#EAE7E0",      // panel enclosure, warm light grey
        panel: "#F8F7F3",     // card surface, near-white
        panel2: "#EFEDE6",    // hover / secondary surface
        line: "#D2CDC1",      // hairline dividers
        ink: "#1C1B17",       // primary text, warm near-black
        muted: "#5F5C53",     // secondary text
        faint: "#95917F",     // tertiary / placeholder text
        alarm: "#B8121F",     // ANSI signal red — danger, E-STOP only
        warn: "#B4700A",      // ANSI safety amber — caution/alarm states
        telemetry: "#155F82", // engineering blueprint blue — data, active state
        ok: "#28703F",        // ANSI safety green — nominal/success
        scope: "#12110D",     // camera/video viewport black (always dark)
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
