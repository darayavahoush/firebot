import React, { useEffect, useState } from "react";
import { playSound } from "../lib/sound.js";

const TITLES = {
  live: { title: "Live Operations", sub: "Real-time telemetry, thermal imaging & teleoperation" },
  sim: { title: "2D Simulator", sub: "Browser simulation engine: RRT* path planner, SLAM & speech" },
  mujoco: { title: "MuJoCo 3D Physics", sub: "High-fidelity rigid-body dynamics & 36-beam lidar sweep" },
  voice: { title: "Voice Studio & Calibration", sub: "Operator acoustic profiling, avatar selection & custom command enrollment" },
  history: { title: "Run History", sub: "Sortie database, fire-suppression analytics & telemetry replay" },
  about: { title: "System Architecture", sub: "State estimation, planning algorithms & hardware specifications" },
};

export default function TopBar({ page, mode, onEstop, activeOperator }) {
  const { title, sub } = TITLES[page] || TITLES.live;
  const [clock, setClock] = useState("");

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setClock(now.toLocaleTimeString("en-GB", { hour12: false }) + " UTC");
    };
    updateTime();
    const id = setInterval(updateTime, 1000);
    return () => clearInterval(id);
  }, []);

  const handleEstop = () => {
    playSound("estop");
    onEstop?.();
  };

  return (
    <header className="bg-base/90 backdrop-blur-md sticky top-0 z-20 border-b border-line">
      <div className="flex items-center justify-between px-6 py-3.5 gap-4">
        {/* Title and breadcrumb */}
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="font-display font-extrabold text-[24px] lg:text-[26px] leading-tight tracking-tight text-ink truncate">
              {title}
            </h1>
            <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider uppercase bg-telemetry/15 text-telemetry border border-telemetry/30">
              MISSION HUD
            </span>
          </div>
          <p className="text-[12px] text-muted truncate mt-0.5">{sub}</p>
        </div>

        {/* Telemetry quick status chips and Emergency Stop button */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Clock */}
          <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-panel border border-line text-[11px] font-mono text-faint">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span className="text-ink font-semibold tabular-nums">{clock}</span>
          </div>

          {/* Active Operator Chip */}
          {activeOperator && (
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-panel border border-line text-[12px]">
              <span className="w-2 h-2 rounded-full bg-telemetry animate-pulse" />
              <span className="text-muted text-[11px] uppercase tracking-wider font-mono">Pilot</span>
              <span className="font-mono font-bold text-[11px] text-ink capitalize tracking-wider">
                {activeOperator}
              </span>
            </div>
          )}

          {/* Mode Pill */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-panel border border-line text-[12px]">
            <span className="text-muted text-[11px] uppercase tracking-wider font-mono">Mode</span>
            <span
              className={`font-mono font-bold text-[11px] px-2 py-0.5 rounded uppercase tracking-wider ${
                mode === "manual"
                  ? "bg-warn/20 text-warn border border-warn/30"
                  : mode === "auto"
                  ? "bg-ok/20 text-ok border border-ok/30"
                  : "bg-telemetry/20 text-telemetry border border-telemetry/30"
              }`}
            >
              {mode}
            </span>
          </div>

          {/* Guarded Emergency Stop button */}
          <button
            onClick={handleEstop}
            aria-label="Emergency stop robot"
            title="Immediate emergency motor and pump shutdown [SPACE / ESC]"
            className="estop-button group relative h-10 px-5 rounded-xl text-white font-display font-black text-[13px] tracking-wider uppercase flex items-center gap-2 transition-all cursor-pointer"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="group-hover:rotate-90 transition-transform duration-200"
            >
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
            <span>E-STOP</span>
          </button>
        </div>
      </div>
      <div className="heat-rule" />
    </header>
  );
}
