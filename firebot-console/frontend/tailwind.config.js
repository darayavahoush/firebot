/** Precision Tactical Robotics Palette: High-contrast slate, emergency red, aerospace cyan, and amber. */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        base: "#0A0D14",       // Deep stealth matte carbon
        panel: "#111622",      // Engineered slate panel
        panel2: "#171E2E",     // Technical graphite
        line: "rgba(255, 255, 255, 0.08)", // Precision hairline border
        line2: "rgba(255, 255, 255, 0.16)",
        ink: "#F8FAFC",        // Pure crisp off-white
        muted: "#94A3B8",      // Cool slate gray
        faint: "#64748B",      // Muted technical gray
        alarm: "#DC2626",      // Emergency rescue red
        flame: "#EA580C",      // Firefighter safety orange
        warn: "#F59E0B",       // Hazard amber
        telemetry: "#0EA5E9",  // Tactical aerospace cyan / telemetry blue
        ok: "#10B981",         // Nominal operational emerald
        scope: "#05070B",
      },
      fontFamily: {
        sans: ["\"Bricolage Grotesque\"", "system-ui", "sans-serif"],
        display: ["\"Bricolage Grotesque\"", "system-ui", "sans-serif"],
        mono: ["\"Martian Mono\"", "ui-monospace", "monospace"],
      },
      borderRadius: { DEFAULT: "8px" },
      boxShadow: {
        panel: "0 8px 24px -12px rgba(0,0,0,0.6)",
        tactical: "0 0 20px -4px rgba(14, 165, 233, 0.15)",
      },
    },
  },
  plugins: [],
};
