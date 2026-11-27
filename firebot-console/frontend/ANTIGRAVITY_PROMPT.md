# Prompt for Antigravity — Firebot UI: illustrations + page integration

Paste everything below the line into Antigravity, with the repo open at `firebot-console/frontend`.

---

## Context
This is the React 18 + Vite + Tailwind 3 frontend of **Firebot**, an autonomous firefighting rover console
(live telemetry, thermal camera, 2D simulator, MuJoCo 3D, voice calibration, run history, architecture docs).
The old UI was dark "cyber-tactical" (neon glows, mono ALL-CAPS everywhere, gradients, custom cursors) and I dislike it.

A new foundation is already in place — **read these first and follow them exactly**:
- `DESIGN.md` — direction, tokens, type, rules
- `src/index.css`, `tailwind.config.js` — tokens as CSS variables (light + dark)
- `src/components/ui/*` — `Panel, Button, Badge, Stat, PageHeader, EmptyState, Illustration`
- `src/lib/illustrations.js` — the illustration slot contract
- `src/components/{Sidebar,TopBar,StatusStrip}.jsx`, `src/pages/Home.jsx` — already redesigned; use as the reference for tone and density
- `src/pages/Home.legacy.jsx` — the OLD home page, kept only so you can port its good content (see Task 3)

Target feel: calm, legible, professional instrument panel. Warm paper background, white cards, hairline borders,
flame-orange brand accent, teal for live/primary, red only for danger/E-STOP. Think Linear / Vercel dashboard
restraint, not a game HUD.

## Task 1 — Illustrations (9 slots)
Create one file per slot in `src/illustrations/<slot>.jsx` (kebab-case filename = slot name). Each default-exports a
React component `({ className = "", title })` that returns an **inline `<svg>`** with a `viewBox` matching the slot's
aspect ratio, `role="img"` and `aria-label={title}`. They are auto-registered — no wiring needed.

**Style (strict):** flat, geometric, line-plus-fill. 2px rounded strokes (`strokeLinecap/Join="round"`), 2–3 fill tones
max, generous whitespace, no gradients, no glows, no drop shadows, no text inside the art, no photoreal detail.
Under ~8 KB each. **Colours only via theme tokens** so both themes work, e.g. `fill="rgb(var(--c-flame))"`,
`stroke="rgb(var(--c-ink) / 0.85)"`, `fill="rgb(var(--c-panel2))"`, `rgb(var(--c-telemetry))`, `rgb(var(--c-faint))`.
Never hard-code hex. Orange (`--c-flame`) is the single hero accent per illustration; teal marks "data/signal".
The rover is the recurring character — keep it consistent across slots: compact tracked chassis, a mast with a
small thermal camera on top, a short spray nozzle turret at the front, three small flame-sensor dots on the nose.

Slots (see `SLOTS` in `src/lib/illustrations.js` for ratios/alt text):
1. `hero-rover` (16:10) — 3/4 side view of the rover on a floor line, a soft flame silhouette in the background, faint
   dashed thermal-sweep arc from the mast. The "brand" illustration; make it the best one.
2. `no-signal` (4:3) — the rover, with a dashed antenna arc and a small "×"/break mark; muted tones.
3. `empty-history` (4:3) — a stack of empty log cards / a clipboard with a dotted path line.
4. `empty-log` (4:3) — a small terminal/chat bubble outline with a blinking-cursor bar.
5. `voice-studio` (16:10) — microphone with a symmetric waveform and a soft ring; teal waveform.
6. `sim-world` (16:10) — top-down floor plan (rooms, doors), a dashed teal planned path, rover dot, orange fire marker.
7. `mujoco-3d` (16:10) — isometric rover with thin lidar rays fanning out to a wall.
8. `architecture` (16:9) — left-to-right block diagram: Sensors → Estimator → Planner → Actuators, connected by arrows.
   Boxes may have simple glyphs but **no text**.
9. `error-generic` (4:3) — the rover tipped slightly, a small warning triangle.

## Task 2 — Place the illustrations
Use `<Illustration name="…" />` (or `PageHeader illustration="…"` / `EmptyState illustration="…"`) at each slot's
`where` location:
- `hero-rover` → already wired in `pages/Home.jsx`; verify it looks right.
- `no-signal` → `LiveOps.jsx` / `ThermalHero.jsx` / `CameraFeed.jsx` when `frame` is null (replace the current "connecting" placeholders).
- `empty-history` → `History.jsx` empty state. `empty-log` → `CommandLog.jsx` empty state.
- `voice-studio`, `sim-world`, `mujoco-3d`, `architecture` → a `PageHeader` at the top of `VoiceCalibration`, `Simulator`,
  `MuJoCo`, `About`. Keep these headers compact (≤ 220px tall) and collapsible/dismissible on the Simulator and MuJoCo
  pages, where the viewport is the hero.
- `error-generic` → wherever a fetch failure currently shows raw error text (History, VoiceCalibration, Home).

## Task 3 — Restyle remaining pages to the new system
Foundation is done; pages still carry old styling. Go page by page, in this order, and bring each to the standard of
`Home.jsx` / `StatusStrip.jsx`:
`LiveOps` (+ `ControlPanel, ModeSwitch, CommandLog, TelemetryGauges, Joystick`) → `Simulator` (+ `components/sim/*`) →
`History` (+ `RunHistoryTable, RunChart, RunInsights, RunReplay`) → `VoiceCalibration` (+ `voice/OperatorAvatars`) →
`MuJoCo` → `About`.

Rules for every file you touch:
- Replace hard-coded colours with tokens. Current leftovers: ~132 hex values, ~121 `rgba()`, 24 `text-white`,
  21 `font-black/extrabold`, 65 `uppercase`. Heaviest: SimCanvas (64), CameraFeed (28), About (27), RunChart (14),
  MuJoCo (13), VoiceCalibration (11), Simulator (10).
  **Exceptions:** thermal imagery / ironbow, and canvas drawing code in `SimCanvas.jsx` / `ThermalFrame.jsx` /
  `MujocoScene.js` — those draw *data* on an always-dark `scope` surface; keep their data colours, but make the
  surrounding frame, legend and overlays token-based, and read canvas label colours from CSS variables where practical.
- Sentence case; remove mono ALL-CAPS headings and `tracking-widest` labels (keep `.panel-eyebrow` only for tiny section
  labels). Mono only for numbers/codes via `.data`.
- Remove glows, neon box-shadows, gradient fills on chrome, emoji used as icons (replace with simple 1.75px-stroke SVG
  line icons matching the Sidebar's), and any use of the removed custom cursor files.
- Prefer `Panel`, `Button`, `Badge`, `Stat`; use `.btn` / `.btn-primary` / `.chip` rather than ad-hoc button classes.
- Recharts (RunChart): series colours via `rgb(var(--c-telemetry))`, `--c-flame`, etc.; grid/axis via `--c-line`/`--c-faint`.
  Chart colours must read well in both themes.
- Mobile: every page usable at 390px width (sidebar collapses to an icon rail or off-canvas drawer below 768px —
  implement this in `Sidebar.jsx`/`App.jsx`), no horizontal page scroll.
- **Port from `Home.legacy.jsx`** into new, token-based components inside `Home.jsx` (below "How it works"): the
  interactive chassis inspection (hotspots over `public/firebot-rover-detail.jpg`) and the optical-vs-thermal smoke
  demo. Restyle them to the new system; keep their data. Then delete `Home.legacy.jsx`.
- Accessibility: visible focus rings (already global), 4.5:1 text contrast in both themes, `aria-label`s on icon buttons,
  respect `prefers-reduced-motion`.

## Do NOT
- Change behaviour, props, state, API calls, WebSocket handling, `src/lib/*` engines, or anything under `backend/`.
- Rename the existing Tailwind tokens or add new colour families — extend via the CSS variables in `index.css` if truly needed.
- Add UI libraries. (Tailwind + the existing deps only; no component kits, no icon packs — inline SVG.)
- Commit `dist/`.

## Acceptance
- `npm run build` passes with no new warnings.
- Every page checked in **light and dark**, at **1440px and 390px**; attach a screenshot grid.
- No remaining hex/rgba in chrome (grep to confirm), no `text-white` except on solid accent/alarm fills.
- Illustrations render in both themes; swapping theme needs no reload.
- The E-STOP remains the only saturated red element on any screen.
