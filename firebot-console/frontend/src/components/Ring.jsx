import React from "react";

export default function Ring({ label, value, low, good }) {
  const R = 30, C = 2 * Math.PI * R, v = Math.max(0, Math.min(1, value));
  const stroke = low ? "#FF4A2B" : good ? "#7DE3B0" : "url(#liveheat)";
  return (
    <div className="flex flex-col items-center gap-1.5" role="img" aria-label={`${label} ${Math.round(v * 100)} percent`}>
      <svg width="76" height="76" viewBox="0 0 76 76">
        <defs><linearGradient id="liveheat" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#5a1a86" /><stop offset=".5" stopColor="#c4286f" /><stop offset="1" stopColor="#ff8a2a" /></linearGradient></defs>
        <circle cx="38" cy="38" r={R} fill="none" stroke="rgba(241,236,250,0.10)" strokeWidth="7" />
        <circle cx="38" cy="38" r={R} fill="none" stroke={stroke} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${C * v} ${C}`} transform="rotate(-90 38 38)" style={{ transition: "stroke-dasharray .4s" }} />
        <text x="38" y="43" textAnchor="middle" className="data" fill="#F1ECFA" fontSize="15">{Math.round(v * 100)}</text>
      </svg>
      <span className="text-[12px] text-muted">{label}</span>
    </div>
  );
}
