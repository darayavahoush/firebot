import React from "react";

const VARIANTS = {
  primary: "btn-primary",
  secondary: "btn",
  danger:
    "inline-flex items-center justify-center gap-2 rounded-lg bg-alarm px-4 py-2 text-[13px] font-semibold text-white hover:brightness-110 active:translate-y-px disabled:opacity-40 disabled:pointer-events-none",
  ghost:
    "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium text-muted hover:text-ink hover:bg-panel2 disabled:opacity-40 disabled:pointer-events-none",
};

export default function Button({ variant = "secondary", className = "", type = "button", ...props }) {
  return <button type={type} className={`${VARIANTS[variant] || VARIANTS.secondary} ${className}`} {...props} />;
}
