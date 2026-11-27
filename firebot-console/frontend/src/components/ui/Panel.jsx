import React from "react";

const STATE_DOT = {
  live: "bg-telemetry animate-pulse",
  hot: "bg-flame",
  alert: "bg-alarm",
  ok: "bg-ok",
};

const STATE_LABEL = {
  live: "LIVE",
  hot: "HOT",
  alert: "ALERT",
  ok: "OK",
};

/** Standard card. `title` renders a header row; `actions` sits on its right; `state` renders a status dot. */
export default function Panel({
  title,
  eyebrow,
  state,
  actions,
  headerRight,
  children,
  className = "",
  bodyClassName = "",
  id,
}) {
  const rightContent = actions || headerRight;
  return (
    <section id={id} className={`panel ${className}`}>
      {(title || rightContent || state) && (
        <header className="panel-header">
          <div className="min-w-0 flex items-center gap-2">
            <div>
              {eyebrow && <div className="panel-eyebrow mb-0.5">{eyebrow}</div>}
              {title && <h2 className="truncate display">{title}</h2>}
            </div>
            {state && (
              <span className="inline-flex items-center gap-1.5 text-[10.5px] font-mono font-medium px-2 py-0.5 rounded border border-line bg-panel2 text-muted shrink-0">
                <span className={`w-1.5 h-1.5 rounded-full ${STATE_DOT[state] || "bg-faint"}`} />
                <span>{STATE_LABEL[state] || state}</span>
              </span>
            )}
          </div>
          {rightContent && <div className="flex items-center gap-2 shrink-0">{rightContent}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
