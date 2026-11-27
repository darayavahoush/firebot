import React, { useState } from "react";
import { playSound, soundEnabled, setSoundEnabled } from "../lib/sound.js";
import { effectiveTheme, toggleTheme } from "../lib/theme.js";

const I = (d) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);

const GROUPS = [
  {
    label: "Operate",
    items: [
      { id: "home", label: "Overview", icon: I(<><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 22V12h6v10" /></>) },
      { id: "live", label: "Live ops", live: true, icon: I(<><circle cx="12" cy="12" r="2" /><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49" /></>) },
    ],
  },
  {
    label: "Simulate",
    items: [
      { id: "sim", label: "2D simulator", icon: I(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></>) },
      { id: "mujoco", label: "3D physics", icon: I(<><path d="m21 16-9 5-9-5V8l9-5 9 5v8z" /><path d="m3.27 6.96 8.73 4.85 8.73-4.85M12 22V12" /></>) },
    ],
  },
  {
    label: "Set up",
    items: [
      { id: "voice", label: "Voice studio", icon: I(<><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" /></>) },
    ],
  },
  {
    label: "Review",
    items: [
      { id: "history", label: "Run history", icon: I(<><path d="M3 3v5h5M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></>) },
      { id: "about", label: "Architecture", icon: I(<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M12 8v4M12 16h.01" /></>) },
    ],
  },
];

function IconButton({ active, onClick, label, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={title || label}
      className={`h-9 w-9 rounded-lg flex items-center justify-center transition-colors ${
        active ? "bg-telemetry/10 text-telemetry" : "text-muted hover:text-ink hover:bg-panel2"
      }`}
    >
      {children}
    </button>
  );
}

const svg = (children) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export default function Sidebar({
  page,
  setPage,
  linkOk,
  notifOn,
  onToggleNotif,
  mobileOpen = false,
  onCloseMobile,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [soundOn, setSoundOn] = useState(soundEnabled);
  const [theme, setThemeState] = useState(effectiveTheme);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled(next);
    if (next) playSound("ack");
  };

  const handleNavClick = (id) => {
    playSound("tab");
    setPage(id);
    onCloseMobile?.();
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div
          role="presentation"
          onClick={onCloseMobile}
          className="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-sm transition-opacity"
        />
      )}

      <aside
        className={`fixed md:sticky top-0 h-screen shrink-0 bg-panel border-r border-line flex flex-col z-50 md:z-30 select-none transition-all duration-200 ${
          mobileOpen ? "translate-x-0 w-[240px]" : "-translate-x-full md:translate-x-0"
        } ${collapsed ? "md:w-[68px]" : "md:w-[228px]"}`}
      >
        {/* Brand */}
        <div className="h-16 px-4 flex items-center justify-between gap-2 border-b border-line">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-flame flex items-center justify-center shrink-0">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="#fff">
                <path d="M12 2c.6 3.2 2.7 4.6 4.2 6.5C17.6 10.2 18 11.6 18 13a6 6 0 1 1-12 0c0-1.7.7-3 1.6-4 .3 1.2 1 2 2 2.3-.4-3 .2-6 2.4-9.3Z" />
              </svg>
            </div>
            {(!collapsed || mobileOpen) && (
              <div className="min-w-0 leading-tight">
                <div className="text-[15px] font-semibold tracking-tight">Firebot</div>
                <div className="text-[11px] text-faint">Operations console</div>
              </div>
            )}
          </div>

          {/* Desktop collapse toggle */}
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden md:flex h-7 w-7 rounded-md text-faint hover:text-ink hover:bg-panel2 items-center justify-center shrink-0"
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
              className={collapsed ? "rotate-180" : ""}
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          {/* Mobile close toggle */}
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close navigation"
            className="flex md:hidden h-8 w-8 rounded-md text-muted hover:text-ink hover:bg-panel2 items-center justify-center shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4" aria-label="Main navigation">
          {GROUPS.map((g) => (
            <div key={g.label}>
              {(!collapsed || mobileOpen) && <div className="panel-eyebrow px-2.5 pb-1.5">{g.label}</div>}
              <div className="space-y-0.5">
                {g.items.map((item) => {
                  const active = page === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleNavClick(item.id)}
                      aria-current={active ? "page" : undefined}
                      title={collapsed && !mobileOpen ? item.label : undefined}
                      className={`relative w-full flex items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13.5px] transition-colors ${
                        active ? "bg-panel2 text-ink font-semibold" : "text-muted hover:text-ink hover:bg-panel2/70"
                      } ${collapsed && !mobileOpen ? "justify-center" : ""}`}
                    >
                      {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-flame" />}
                      <span className={`shrink-0 ${active ? "text-flame" : "text-faint"}`}>{item.icon}</span>
                      {(!collapsed || mobileOpen) && <span className="flex-1 truncate">{item.label}</span>}
                      {(!collapsed || mobileOpen) && item.live && (
                        <span className={`h-2 w-2 rounded-full ${linkOk ? "bg-ok" : "bg-alarm pulse-dot"}`} aria-hidden />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-line p-3 space-y-2.5">
          <div
            className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] ${
              linkOk ? "bg-ok/10 text-ok" : "bg-alarm/10 text-alarm"
            } ${collapsed && !mobileOpen ? "justify-center" : ""}`}
            title={linkOk ? "Telemetry streaming" : "Robot link lost"}
          >
            <span className={`h-2 w-2 rounded-full bg-current shrink-0 ${linkOk ? "" : "pulse-dot"}`} />
            {(!collapsed || mobileOpen) && <span className="font-medium">{linkOk ? "Telemetry OK" : "Link lost"}</span>}
          </div>

          <div className={`flex items-center ${collapsed && !mobileOpen ? "flex-col" : "justify-between"} gap-1`}>
            <IconButton
              active={soundOn}
              onClick={toggleSound}
              label={soundOn ? "Mute interface sounds" : "Enable interface sounds"}
            >
              {soundOn
                ? svg(<><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></>)
                : svg(<><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>)}
            </IconButton>
            {onToggleNotif && (
              <IconButton
                active={!!notifOn}
                onClick={onToggleNotif}
                label={notifOn ? "Turn off background alerts" : "Turn on background alerts"}
              >
                {svg(<><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />{!notifOn && <line x1="1" y1="1" x2="23" y2="23" />}</>)}
              </IconButton>
            )}
            <IconButton
              onClick={() => setThemeState(toggleTheme())}
              label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            >
              {theme === "dark"
                ? svg(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></>)
                : svg(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />)}
            </IconButton>
          </div>
        </div>
      </aside>
    </>
  );
}
