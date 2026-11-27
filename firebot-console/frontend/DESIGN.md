# Firebot console — design system (v3)

**Direction:** calm, legible, instrument-like. Warm paper background, white cards, one brand accent
(flame orange) for identity, teal for "live / primary action", red reserved for danger. No glows,
no neon, no gradients on chrome, no custom cursors. Dark theme is a first-class twin, not an afterthought.

## Tokens (src/index.css → tailwind.config.js)
Names are unchanged from the old config so existing pages keep compiling; values are CSS variables.

| Token | Role | Light | Dark |
|---|---|---|---|
| `base` | page background | #F6F5F2 | #0F1114 |
| `panel` / `panel2` | card / recessed surface | #FFF / #F1EFEB | #171A1F / #1F232A |
| `line` / `line2` | hairline / strong border | #E2DFD8 / #CDC9C0 | #2A2F38 / #3E4450 |
| `ink` / `muted` / `faint` | text levels | #16181D / #5B6270 / #8A909C | #ECEEF1 / #9CA3AF / #6B7280 |
| `telemetry` | primary action, live data | #0E7C7B | #34BEBA |
| `flame` | brand accent, active nav | #E8590C | #FB7832 |
| `alarm` / `warn` / `ok` | danger / caution / nominal | #D92D20 / #B45309 / #15803D | lighter equivalents |
| `scope` | always-dark viewports (thermal, lidar, sim canvas) | #0C0E12 | #08090B |
| `onaccent` | text on telemetry fills | #FFF | #061616 |

Opacity modifiers work (`bg-panel/80`). In SVG/inline styles use `rgb(var(--c-flame))`, `rgb(var(--c-ink) / 0.6)`.

## Type
Instrument Sans (UI) + IBM Plex Mono (numbers, codes, timestamps only — use `.data`).
Sentence case everywhere. ALL-CAPS only for the tiny `.panel-eyebrow` label. No `font-black`.

## Components
`.panel`, `.panel-header`, `.panel-eyebrow`, `.btn`, `.btn-primary`, `.chip`, `.estop-button`, `.data`
and React primitives in `src/components/ui/`: `Panel`, `Button`, `Badge`, `Stat`, `PageHeader`, `EmptyState`, `Illustration`.

## Illustrations
Slots are declared in `src/lib/illustrations.js`; art lives in `src/illustrations/<slot>.jsx` and is picked up
automatically. See `src/illustrations/README.md`.

## Rules
1. Thermal imagery and the ironbow palette (`--ironbow`, `.heatbar`) stay as they are — they are data, not chrome.
2. Only one red, loud thing per screen: the E-STOP.
3. Never hard-code hex/rgba in chrome. Use tokens so both themes work.
