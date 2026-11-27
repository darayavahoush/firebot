# Illustrations

One file per slot, named exactly like the slot in `src/lib/illustrations.js`:

    src/illustrations/hero-rover.jsx

```jsx
export default function HeroRover({ className = "", title }) {
  return (
    <svg viewBox="0 0 640 400" className={className} role="img" aria-label={title}>
      {/* use theme tokens, never hard-coded hex: */}
      <path d="…" fill="rgb(var(--c-flame))" />
      <path d="…" stroke="rgb(var(--c-ink) / 0.85)" fill="none" strokeWidth="2" />
    </svg>
  );
}
```

Tokens available: `--c-base --c-panel --c-panel2 --c-line --c-line2 --c-ink --c-muted --c-faint --c-flame --c-telemetry --c-alarm --c-warn --c-ok`.
Files are auto-registered (`import.meta.glob`); until a file exists the slot shows a labelled placeholder.
