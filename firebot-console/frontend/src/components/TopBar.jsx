import React from "react";

const TITLES = {
  live: { title: "Live operations", sub: "Telemetry and manual control" },
  sim: { title: "Simulator", sub: "Procedural map, mock sensors, planner, voice control" },
  mujoco: { title: "MuJoCo", sub: "Physics-backed 3D world, live from the backend" },
  history: { title: "Run history", sub: "Logged runs from Postgres" },
  about: { title: "About", sub: "The algorithms behind the robot" },
};

export default function TopBar({ page, mode, onEstop }) {
  const { title, sub } = TITLES[page];
  return (
    <header className="bg-base">
      <div className="flex items-end justify-between px-6 pt-5 pb-4">
        <div>
          <h1 className="font-display font-extrabold text-[34px] leading-none tracking-tight">{title}</h1>
          <p className="text-[13px] text-muted mt-1.5">{sub}</p>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-[13px] text-muted">
            Mode <span className="data text-ink ml-1 px-2 py-1 rounded bg-panel2">{mode}</span>
          </div>
          <button
            onClick={onEstop}
            aria-label="Emergency stop"
            className="h-12 px-5 rounded-full bg-alarm text-[#1A0605] font-display font-extrabold text-[15px] hover:brightness-110 active:scale-95 transition shadow-[0_0_0_4px_rgba(255,74,43,0.22)]"
          >
            Stop
          </button>
        </div>
      </div>
      <div className="heat-rule" />
    </header>
  );
}
