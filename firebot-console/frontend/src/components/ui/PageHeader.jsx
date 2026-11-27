import React from "react";
import Illustration from "./Illustration.jsx";

/**
 * In-page hero/header for pages that want an illustration beside the title.
 * (The sticky TopBar already shows the page title; use this for the first block of a page body.)
 */
export default function PageHeader({ eyebrow, title, description, illustration, actions, className = "" }) {
  return (
    <div className={`panel flex flex-col-reverse md:flex-row items-stretch ${className}`}>
      <div className="flex-1 p-6 md:p-8 flex flex-col justify-center gap-3">
        {eyebrow && <div className="panel-eyebrow">{eyebrow}</div>}
        <h2 className="text-[26px] md:text-[30px] leading-tight font-semibold tracking-tight">{title}</h2>
        {description && <p className="text-[14px] text-muted max-w-[56ch]">{description}</p>}
        {actions && <div className="flex flex-wrap gap-2 pt-1">{actions}</div>}
      </div>
      {illustration && (
        <div className="md:w-[42%] bg-panel2 border-b md:border-b-0 md:border-l border-line flex items-center justify-center p-4">
          <Illustration name={illustration} className="w-full max-h-[260px]" />
        </div>
      )}
    </div>
  );
}
