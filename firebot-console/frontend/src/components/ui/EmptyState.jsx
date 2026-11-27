import React from "react";
import Illustration from "./Illustration.jsx";

export default function EmptyState({ illustration, title, description, action, className = "" }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center gap-3 py-10 px-6 ${className}`}>
      {illustration && <Illustration name={illustration} className="w-[200px] max-w-full" />}
      <div className="text-[15px] font-semibold">{title}</div>
      {description && <p className="text-[13px] text-muted max-w-[44ch]">{description}</p>}
      {action}
    </div>
  );
}
