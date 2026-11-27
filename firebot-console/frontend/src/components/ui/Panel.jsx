import React from "react";

/** Standard card. `title` renders a header row; `actions` sits on its right. */
export default function Panel({ title, eyebrow, actions, children, className = "", bodyClassName = "" }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel-header">
          <div className="min-w-0">
            {eyebrow && <div className="panel-eyebrow mb-0.5">{eyebrow}</div>}
            <h2 className="truncate">{title}</h2>
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
