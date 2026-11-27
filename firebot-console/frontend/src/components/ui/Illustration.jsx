import React from "react";
import { SLOTS } from "../../lib/illustrations.js";

/**
 * Illustration slot.
 *
 * Any file dropped in src/illustrations/<name>.jsx (default-exporting a React component that draws
 * an inline <svg>) is picked up automatically — no registration step. Until the file exists, this
 * renders a neutral placeholder that names the slot, so layouts can be built and reviewed first.
 *
 * Illustrations are inline SVG React components (not <img>) so they can use the theme tokens:
 *   fill="rgb(var(--c-flame))"   stroke="rgb(var(--c-ink) / 0.8)"   etc.
 * That is what keeps them correct in both light and dark themes.
 */
const modules = import.meta.glob("../../illustrations/*.jsx", { eager: true });
const REGISTRY = Object.fromEntries(
  Object.entries(modules).map(([path, mod]) => [path.split("/").pop().replace(/\.jsx$/, ""), mod.default]),
);

export default function Illustration({ name, className = "", title }) {
  const Art = REGISTRY[name];
  const slot = SLOTS[name];
  if (Art) return <Art className={className} title={title ?? slot?.alt} />;

  return (
    <div
      role="img"
      aria-label={slot?.alt || name}
      style={{ aspectRatio: slot?.ratio || "4 / 3" }}
      className={`flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line2 text-faint text-center p-3 ${className}`}
    >
      <span className="text-[11px] font-mono">illustration</span>
      <span className="text-[12px] font-medium text-muted">{name}</span>
    </div>
  );
}
