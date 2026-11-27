import React, { useState } from "react";
import StatusStrip from "../components/StatusStrip.jsx";
import ThermalHero from "../components/ThermalHero.jsx";
import Ring from "../components/Ring.jsx";
import CameraFeed from "../components/CameraFeed.jsx";
import ControlPanel from "../components/ControlPanel.jsx";
import ModeSwitch from "../components/ModeSwitch.jsx";
import CommandLog from "../components/CommandLog.jsx";
import { playSound } from "../lib/sound.js";

export default function LiveOps({ frame, mode, setMode, log, onAnalog, onPump, onNozzle }) {
  const [viewMode, setViewMode] = useState("split"); // "split" | "thermal" | "optical"
  const gas = Math.max(frame?.sensors?.mq2_front ?? 0, frame?.sensors?.mq2_rear ?? 0);
  const fix = frame?.est_sigma != null ? 1 - Math.min(frame.est_sigma, 4) / 4 : null;

  const handleViewChange = (v) => {
    playSound("tab");
    setViewMode(v);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <StatusStrip frame={frame} mode={mode} logCount={log.length} />

      {/* Quick Deck Subheader: View Controls & Hardware PDF Quick Link */}
      <div className="px-6 py-2.5 bg-panel2/50 border-b border-line flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        {/* Feed Layout Toggle */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-panel border border-line">
          <button
            onClick={() => handleViewChange("split")}
            className={`px-3 py-1 rounded-lg transition-all duration-150 flex items-center gap-1.5 ${
              viewMode === "split"
                ? "bg-telemetry/20 text-telemetry font-bold border border-telemetry/40 shadow-sm"
                : "text-muted hover:text-ink"
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="12" y1="3" x2="12" y2="21" />
            </svg>
            Split View
          </button>

          <button
            onClick={() => handleViewChange("thermal")}
            className={`px-3 py-1 rounded-lg transition-all duration-150 flex items-center gap-1.5 ${
              viewMode === "thermal"
                ? "bg-flame/20 text-flame font-bold border border-flame/40 shadow-sm"
                : "text-muted hover:text-ink"
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2c1 3 2.5 3.5 3.5 4.5A5 5 0 0 1 17 10a5 5 0 1 1-10 0c0-1.6.6-3.1 1.5-3.5 1-1 2.5-1.5 3.5-4.5Z" />
            </svg>
            FLIR Thermal Only
          </button>

          <button
            onClick={() => handleViewChange("optical")}
            className={`px-3 py-1 rounded-lg transition-all duration-150 flex items-center gap-1.5 ${
              viewMode === "optical"
                ? "bg-ok/20 text-ok font-bold border border-ok/40 shadow-sm"
                : "text-muted hover:text-ink"
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            Tactical Optical (CAM-01)
          </button>
        </div>

        {/* Rover & Documentation Pill */}
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex items-center gap-1.5 text-faint">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" />
            TCP :8765 LINK
          </span>
          <a
            href="/FireBot_Hardware_and_Wiring_Specification.pdf"
            download="FireBot_Hardware_and_Wiring_Specification.pdf"
            className="px-3 py-1 rounded-lg bg-panel hover:bg-panel2 border border-line hover:border-line2 text-muted hover:text-ink transition-all flex items-center gap-1.5"
            title="Download complete ESP32 & Raspberry Pi hardware specification PDF"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ok">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Hardware Spec (PDF)
          </a>
        </div>
      </div>

      <div className="p-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px] items-start">
        {/* Left Column: Visual Feeds & Vital Sensor Rings */}
        <div className="flex flex-col gap-6 min-w-0">
          {/* Main Visual Station based on viewMode */}
          {viewMode === "split" && (
            <div className="space-y-6">
              {/* Thermal FLIR Station */}
              <ThermalHero frame={frame} />
              {/* Tactical Camera Feed */}
              <div className="space-y-2">
                <CameraFeed frame={frame} />
                <p className="text-[11px] font-mono text-faint px-1">
                  CAM-01 • Forward optical feed & thermal lock-on overlay. High-speed video stream synchronized with MLX90640.
                </p>
              </div>
            </div>
          )}

          {viewMode === "thermal" && (
            <div className="space-y-2">
              <ThermalHero frame={frame} />
              <p className="text-[11px] font-mono text-faint px-1">
                MLX90640-D55 32×24 Far-Infrared sensor stream @ 8 Hz. Radiometric temperature gradients pierce dense smoke.
              </p>
            </div>
          )}

          {viewMode === "optical" && (
            <div className="space-y-2">
              <CameraFeed frame={frame} />
              <p className="text-[11px] font-mono text-faint px-1">
                CAM-01 • Forward tactical optical feed & synthetic corridor view. Responsive vanishing-point pan tracking turn commands.
              </p>
            </div>
          )}

          {/* Critical Gauges Bar */}
          <div className="panel p-5 rounded-2xl border border-line bg-panel/80">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-line">
              <span className="text-[12px] font-mono uppercase tracking-wider text-muted font-medium flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-ok" />
                Vessel State &amp; Environment Telemetry
              </span>
              <span className="text-[11px] font-mono text-faint">
                REAL-TIME SENSORS (10 HZ)
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 items-center">
              <Ring
                label="Water Tank"
                value={frame?.tank ?? 0.85}
                low={(frame?.tank ?? 0.85) < 0.2}
              />
              <Ring
                label="Gas Sensor"
                value={gas}
                low={gas > 0.25}
              />
              <Ring
                label="Fire Fix"
                value={fix ?? 0}
                good={fix != null && fix > 0.6}
              />

              {/* Position & Odometry Card */}
              <div className="flex flex-col justify-center p-3 rounded-2xl bg-panel2/40 border border-line space-y-2">
                <div className="text-[10px] font-mono uppercase tracking-wider text-faint">
                  Odometry Pose
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between items-baseline text-[11px] font-mono">
                    <span className="text-muted">POS X:</span>
                    <span className="text-ink font-bold">{frame ? frame.x.toFixed(2) : "0.00"} m</span>
                  </div>
                  <div className="flex justify-between items-baseline text-[11px] font-mono">
                    <span className="text-muted">POS Y:</span>
                    <span className="text-ink font-bold">{frame ? frame.y.toFixed(2) : "0.00"} m</span>
                  </div>
                  <div className="flex justify-between items-baseline text-[11px] font-mono">
                    <span className="text-muted">HEADING:</span>
                    <span className="text-telemetry font-bold">
                      {frame?.th != null ? `${((frame.th * 180) / Math.PI).toFixed(0)}°` : "0°"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Teleoperation, Modes & Event Audit */}
        <div className="flex flex-col gap-5">
          <ModeSwitch mode={mode} onChange={setMode} />
          <ControlPanel
            enabled={mode === "manual"}
            onAnalog={onAnalog}
            onPump={onPump}
            onNozzle={onNozzle}
          />
          <CommandLog entries={log} />
        </div>
      </div>
    </div>
  );
}
