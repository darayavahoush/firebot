/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        base: "#0F1417",
        panel: "#161C21",
        panel2: "#1C232A",
        line: "#262E35",
        ink: "#E7EDF2",
        muted: "#8A97A3",
        faint: "#5C6871",
        alarm: "#E8432F",
        warn: "#F5A623",
        telemetry: "#3FA7D6",
        ok: "#4CAF6D",
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
