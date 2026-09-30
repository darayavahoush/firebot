import React, { useState } from "react";
import { playSound, soundEnabled, setSoundEnabled } from "../lib/sound.js";

const NAV = [
  {
    id: "live",
    label: "Live Ops",
    sub: "Telemetry & Teleop",
    badge: "LIVE",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a10 10 0 0 0-10 10c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.1-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2z" className="hidden" />
        <circle cx="12" cy="12" r="2" />
        <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
      </svg>
    ),
  },
  {
    id: "sim",
    label: "2D Simulator",
    sub: "RRT* & SLAM Demo",
    badge: "2D",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M9 21V9" />
        <circle cx="15" cy="15" r="2" />
      </svg>
    ),
  },
  {
    id: "mujoco",
    label: "MuJoCo 3D",
    sub: "Physics & Lidar Sim",
    badge: "3D",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m21 16-9 5-9-5V8l9-5 9 5v8z" />
        <path d="m3.27 6.96 8.73 4.85 8.73-4.85M12 22V12" />
      </svg>
    ),
  },
  {
    id: "voice",
    label: "Voice Studio",
    sub: "Operator Calibration",
    badge: "AI",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" x2="12" y1="19" y2="22" />
      </svg>
    ),
  },
  {
    id: "history",
    label: "Run History",
    sub: "Telemetry Archives",
    badge: null,
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v5h5M3.05 13A9 9 0 1 0 6 5.3L3 8" />
        <path d="M12 7v5l4 2" />
      </svg>
    ),
  },
  {
    id: "about",
    label: "Architecture",
    sub: "Algorithms & Sensors",
    badge: "DOCS",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
    ),
  },
];

export default function Sidebar({ page, setPage, linkOk, notifOn, onToggleNotif }) {
  const [collapsed, setCollapsed] = useState(false);
  const [soundOn, setSoundOn] = useState(soundEnabled);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled(next);
    if (next) playSound("ack");
  };

  const handleNav = (id) => {
    playSound("tab");
    setPage(id);
  };

  return (
    <aside
      className={`shrink-0 bg-panel/95 backdrop-blur-xl border-r border-line flex flex-col justify-between transition-all duration-200 z-30 select-none ${
        collapsed ? "w-[72px]" : "w-[240px]"
      }`}
    >
      {/* Brand Header */}
      <div>
        <div className="h-16 px-4 flex items-center justify-between border-b border-line">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="relative h-9 w-9 rounded-xl bg-gradient-to-br from-telemetry via-[#C4286F] to-warn flex items-center justify-center shadow-[0_0_16px_rgba(240,85,155,0.4)] shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0E0919" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
              </svg>
            </div>
            {!collapsed && (
              <div className="flex flex-col min-w-0">
                <span className="font-display font-black text-[16px] tracking-wider text-ink leading-tight">
                  NIRVANA
                </span>
                <span className="text-[10px] font-mono tracking-widest text-telemetry uppercase leading-none font-semibold">
                  FIREBOT v2.5
                </span>
              </div>
            )}
          </div>
          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="h-7 w-7 rounded-lg border border-line text-faint hover:text-ink hover:border-line/80 flex items-center justify-center transition-colors"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`}
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="p-2 space-y-1.5" aria-label="Main Navigation">
          {NAV.map((item) => {
            const active = page === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNav(item.id)}
                aria-current={active ? "page" : undefined}
                title={collapsed ? `${item.label} — ${item.sub}` : undefined}
                className={`group relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-150 ${
                  active
                    ? "bg-gradient-to-r from-telemetry/20 to-panel2/60 text-ink font-semibold shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] border border-telemetry/40"
                    : "text-muted hover:text-ink hover:bg-panel2/60 border border-transparent"
                }`}
              >
                {/* Active Glowing Left Pill */}
                {active && (
                  <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-gradient-to-b from-[#ff8a2a] via-telemetry to-[#c4286f] shadow-[0_0_8px_#f0559b]" />
                )}

                <span
                  className={`shrink-0 transition-transform group-hover:scale-110 ${
                    active ? "text-telemetry" : "text-faint group-hover:text-ink"
                  }`}
                >
                  {item.icon}
                </span>

                {!collapsed && (
                  <div className="flex-1 min-w-0 flex items-center justify-between">
                    <div className="flex flex-col min-w-0">
                      <span className="text-[13px] leading-tight truncate">{item.label}</span>
                      <span className="text-[10px] text-faint leading-tight truncate">{item.sub}</span>
                    </div>
                    {item.badge && (
                      <span
                        className={`text-[9px] font-mono px-1.5 py-0.5 rounded-md uppercase font-bold tracking-wider ${
                          item.badge === "LIVE"
                            ? "bg-alarm/20 text-alarm border border-alarm/30 pulse-dot"
                            : "bg-panel2 text-faint border border-line"
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer Controls */}
      <div className="p-3 border-t border-line space-y-2 bg-panel2/30">
        {/* Link Status Pill */}
        <div
          className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-[11px] font-mono transition-colors ${
            linkOk
              ? "bg-ok/10 border-ok/30 text-ok"
              : "bg-alarm/15 border-alarm/40 text-alarm"
          }`}
          title={linkOk ? "Telemetry streaming nominal" : "Robot connection lost"}
        >
          <span className={`h-2 w-2 rounded-full shrink-0 ${linkOk ? "bg-ok" : "bg-alarm pulse-dot"}`} />
          {!collapsed && (
            <span className="truncate font-semibold tracking-wider">
              {linkOk ? "TELEMETRY OK" : "LINK LOST"}
            </span>
          )}
        </div>

        {/* Audio & Alerts Controls */}
        <div className={`flex items-center ${collapsed ? "flex-col" : "justify-between"} gap-1.5`}>
          <button
            onClick={toggleSound}
            aria-label={soundOn ? "Mute interface audio" : "Enable interface audio"}
            title={soundOn ? "Tactile audio feedback: ON" : "Tactile audio feedback: OFF"}
            className={`h-9 w-9 rounded-xl border flex items-center justify-center transition-colors ${
              soundOn
                ? "border-telemetry/40 bg-telemetry/15 text-telemetry"
                : "border-line text-faint hover:text-ink hover:bg-panel2"
            }`}
          >
            {soundOn ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            )}
          </button>

          {onToggleNotif && (
            <button
              onClick={onToggleNotif}
              aria-pressed={!!notifOn}
              aria-label={notifOn ? "Turn off background alerts" : "Turn on background alerts"}
              title={notifOn ? "Background tab notifications: ON" : "Turn on notifications"}
              className={`h-9 w-9 rounded-xl border flex items-center justify-center transition-colors ${
                notifOn
                  ? "border-telemetry/40 bg-telemetry/15 text-telemetry"
                  : "border-line text-faint hover:text-ink hover:bg-panel2"
              }`}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                {!notifOn && <line x1="1" y1="1" x2="23" y2="23" />}
              </svg>
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
