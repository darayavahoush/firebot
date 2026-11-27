import React, { useEffect, useState } from "react";
import { playSound } from "../lib/sound.js";

const TITLES = {
  home: { title: "Overview", sub: "The rover, its sensors and how it finds fires" },
  live: { title: "Live ops", sub: "Telemetry, thermal imaging and teleoperation" },
  sim: { title: "2D simulator", sub: "Plan, map and search in the browser — RRT*, SLAM and voice" },
  mujoco: { title: "3D physics", sub: "Rigid-body dynamics and lidar sweep" },
  voice: { title: "Voice studio", sub: "Operator profiles and custom command enrollment" },
  history: { title: "Run history", sub: "Past sorties, analytics and replay" },
  about: { title: "Architecture", sub: "State estimation, planning and hardware" },
};

const MODE_TONE = {
  manual: "bg-warn/10 text-warn border-warn/30",
  auto: "bg-ok/10 text-ok border-ok/30",
};

export default function TopBar({ page, mode, onEstop, activeOperator, onExitToHome, onOpenNav }) {
  const { title, sub } = TITLES[page] || TITLES.live;
  const [clock, setClock] = useState("");

  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString("en-GB", { hour12: false, timeZone: "UTC" }) + " UTC");
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const handleEstop = () => {
    playSound("estop");
    onEstop?.();
  };

  return (
    <header className="sticky top-0 z-20 bg-base/85 backdrop-blur border-b border-line">
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 h-16">
        <div className="flex items-center gap-3 min-w-0">
          {/* Mobile Navigation Drawer Trigger */}
          <button
            type="button"
            onClick={() => {
              playSound("tab");
              onOpenNav?.();
            }}
            aria-label="Open navigation menu"
            className="md:hidden h-9 w-9 rounded-lg border border-line bg-panel flex items-center justify-center text-muted hover:text-ink shrink-0"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          <div className="min-w-0">
            <h1 className="text-[17px] sm:text-[18px] font-semibold tracking-tight leading-tight truncate">{title}</h1>
            <p className="text-[12px] text-muted truncate hidden sm:block">{sub}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
          {onExitToHome && page !== "home" && (
            <button
              type="button"
              onClick={() => { playSound("tab"); onExitToHome(); }}
              className="btn hidden sm:inline-flex"
              title="Back to overview [H]"
            >
              Overview <kbd className="text-[10px] font-mono text-faint ml-1">H</kbd>
            </button>
          )}

          <span className="hidden lg:inline data text-[12px] text-muted px-1">{clock}</span>

          {activeOperator && (
            <span className="hidden md:inline-flex items-center gap-2 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[12px]">
              <span className="text-muted">Operator</span>
              <span className="font-semibold capitalize">{activeOperator}</span>
            </span>
          )}

          <span className={`inline-flex items-center gap-1.5 sm:gap-2 rounded-lg border px-2 sm:px-2.5 py-1 sm:py-1.5 text-[11px] sm:text-[12px] ${MODE_TONE[mode] || "bg-telemetry/10 text-telemetry border-telemetry/30"}`}>
            <span className="text-current/70">Mode</span>
            <span className="font-semibold capitalize">{mode}</span>
          </span>

          <button
            type="button"
            onClick={handleEstop}
            aria-label="Emergency stop"
            title="Immediately stop motors and pump"
            className="estop-button h-9 sm:h-10 px-3 sm:px-4 rounded-lg text-[12px] sm:text-[13px] font-bold tracking-wide inline-flex items-center gap-1.5 sm:gap-2"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <rect x="3" y="3" width="18" height="18" rx="2" />
            </svg>
            <span>E-STOP</span>
          </button>
        </div>
      </div>
    </header>
  );
}
