/**
 * Firebot design tokens.
 *
 * Token NAMES are unchanged from the old config (base, panel, panel2, line, ink, muted, faint,
 * alarm, flame, warn, telemetry, ok, scope) so every existing page keeps working. Their VALUES now
 * come from CSS variables in src/index.css, which is what makes light/dark theming work.
 * Opacity modifiers (bg-panel/90, border-line/60 …) still work via the <alpha-value> placeholder.
 */
const token = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        base: token("base"),         // page background
        panel: token("panel"),       // cards / surfaces
        panel2: token("panel2"),     // recessed / hover surfaces
        line: token("line"),         // hairline borders
        line2: token("line2"),       // stronger borders
        ink: token("ink"),           // primary text
        muted: token("muted"),       // secondary text
        faint: token("faint"),       // tertiary text / icons
        alarm: token("alarm"),       // emergency, destructive
        flame: token("flame"),       // brand accent (fire / thermal)
        warn: token("warn"),         // caution
        telemetry: token("telemetry"), // primary action + live data
        ok: token("ok"),             // nominal
        scope: token("scope"),       // always-dark viewports (thermal, lidar, canvas)
        onaccent: token("onaccent"), // text on top of telemetry / alarm fills
      },
      fontFamily: {
        sans: ["\"Instrument Sans\"", "system-ui", "sans-serif"],
        display: ["\"Instrument Sans\"", "system-ui", "sans-serif"],
        mono: ["\"IBM Plex Mono\"", "ui-monospace", "monospace"],
      },
      borderRadius: { DEFAULT: "8px" },
      boxShadow: {
        panel: "0 1px 2px rgb(var(--c-shadow) / 0.06), 0 4px 16px -6px rgb(var(--c-shadow) / 0.08)",
        pop: "0 8px 30px -8px rgb(var(--c-shadow) / 0.25)",
      },
      keyframes: {
        fadeIn: { from: { opacity: 0, transform: "translateY(-4px)" }, to: { opacity: 1, transform: "none" } },
      },
      animation: { fadeIn: "fadeIn 160ms ease-out" },
    },
  },
  plugins: [],
};
