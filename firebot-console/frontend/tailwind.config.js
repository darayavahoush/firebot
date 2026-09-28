/** Thermal-imager palette: the cold end of an ironbow ramp is the shell, the hot end is signal. */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        base: "#0E0919", panel: "#171027", panel2: "#211736",
        line: "rgba(226,214,255,0.11)", ink: "#F1ECFA",
        muted: "rgba(241,236,250,0.62)", faint: "rgba(241,236,250,0.36)",
        alarm: "#FF4A2B", warn: "#FFB238", telemetry: "#F0559B", ok: "#7DE3B0", scope: "#000000",
      },
      fontFamily: {
        sans: ["\"Bricolage Grotesque\"", "system-ui", "sans-serif"],
        display: ["\"Bricolage Grotesque\"", "system-ui", "sans-serif"],
        mono: ["\"Martian Mono\"", "ui-monospace", "monospace"],
      },
      borderRadius: { DEFAULT: "8px" },
      boxShadow: { panel: "0 8px 24px -12px rgba(0,0,0,0.6)" },
    },
  },
  plugins: [],
};
