import React, { useState } from "react";
import StatusStrip from "../components/StatusStrip.jsx";
import ThermalHero from "../components/ThermalHero.jsx";
import Ring from "../components/Ring.jsx";
import CameraFeed from "../components/CameraFeed.jsx";
import ControlPanel from "../components/ControlPanel.jsx";
import ModeSwitch from "../components/ModeSwitch.jsx";
import CommandLog from "../components/CommandLog.jsx";
import { playSound } from "../lib/sound.js";
import { Panel } from "../components/ui";

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

      {/* View Controls & Hardware Spec Quick Link */}
      <div className="px-4 sm:px-6 py-2.5 bg-panel2/40 border-b border-line flex flex-wrap items-center justify-between gap-3 text-[12px]">
        {/* Feed Layout Toggle */}
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-panel border border-line">
          <button
            type="button"
            onClick={() => handleViewChange("split")}
            className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 ${
              viewMode === "split"
                ? "bg-telemetry text-onaccent font-medium"
                : "text-muted hover:text-ink"
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="12" y1="3" x2="12" y2="21" />
            </svg>
            <span>Split view</span>
          </button>

          <button
            type="button"
            onClick={() => handleViewChange("thermal")}
            className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 ${
              viewMode === "thermal"
                ? "bg-telemetry text-onaccent font-medium"
                : "text-muted hover:text-ink"
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2c1 3 2.5 3.5 3.5 4.5A5 5 0 0 1 17 10a5 5 0 1 1-10 0c0-1.6.6-3.1 1.5-3.5 1-1 2.5-1.5 3.5-4.5Z" />
            </svg>
            <span>Thermal only</span>
          </button>

          <button
            type="button"
            onClick={() => handleViewChange("optical")}
            className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 ${
              viewMode === "optical"
                ? "bg-telemetry text-onaccent font-medium"
                : "text-muted hover:text-ink"
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <span>Optical only</span>
          </button>
        </div>

        {/* Documentation Link */}
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex items-center gap-1.5 text-faint data text-[11px]">
            <span className={`h-1.5 w-1.5 rounded-full ${frame ? "bg-ok" : "bg-alarm"}`} />
            {frame ? "TCP :8765 link" : "Awaiting link"}
          </span>
          <a
            href="/FireBot_Hardware_and_Wiring_Specification.pdf"
            download="FireBot_Hardware_and_Wiring_Specification.pdf"
            className="px-2.5 py-1 rounded-md bg-panel hover:bg-panel2 border border-line text-muted hover:text-ink transition-colors flex items-center gap-1.5 text-[12px]"
            title="Download complete ESP32 & Raspberry Pi hardware specification PDF"
          >
            <span>Wiring PDF</span>
            <span className="text-faint">↓</span>
          </a>
        </div>
      </div>

      <div className="p-4 sm:p-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px] items-start">
        {/* Left Column: Visual Feeds & Vital Sensor Rings */}
        <div className="flex flex-col gap-6 min-w-0">
          {viewMode === "split" && (
            <div className="space-y-6">
              <ThermalHero frame={frame} />
              <div className="space-y-1.5">
                <CameraFeed frame={frame} />
                <p className="text-[12px] text-muted px-1">
                  Forward optical stream synchronized with FLIR MLX90640 radiometric array.
                </p>
              </div>
            </div>
          )}

          {viewMode === "thermal" && (
            <div className="space-y-1.5">
              <ThermalHero frame={frame} />
              <p className="text-[12px] text-muted px-1">
                MLX90640 32×24 far-infrared sensor stream at 8 Hz. Radiometric temperature gradients pierce dense smoke.
              </p>
            </div>
          )}

          {viewMode === "optical" && (
            <div className="space-y-1.5">
              <CameraFeed frame={frame} />
              <p className="text-[12px] text-muted px-1">
                Forward optical camera stream with vanishing-point turn responsive tracking.
              </p>
            </div>
          )}

          {/* Critical Gauges Bar */}
          <Panel
            title="Vessel state & telemetry telemetry"
            headerRight={<span className="data text-[11px] text-faint">10 Hz sampling</span>}
          >
            <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 items-center">
              <Ring
                label="Water tank"
                value={frame?.tank ?? 0.85}
                low={(frame?.tank ?? 0.85) < 0.2}
              />
              <Ring
                label="Gas sensor"
                value={gas}
                low={gas > 0.25}
              />
              <Ring
                label="Fire fix"
                value={fix ?? 0}
                good={fix != null && fix > 0.6}
              />

              {/* Position & Odometry Card */}
              <div className="flex flex-col justify-center p-3 rounded-xl bg-panel2/40 border border-line space-y-1.5">
                <div className="panel-eyebrow text-[10px]">
                  Odometry pose
                </div>
                <div className="space-y-1 text-[12px]">
                  <div className="flex justify-between items-baseline">
                    <span className="text-muted">Pos X:</span>
                    <span className="data text-ink font-semibold">{frame ? frame.x.toFixed(2) : "0.00"} m</span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-muted">Pos Y:</span>
                    <span className="data text-ink font-semibold">{frame ? frame.y.toFixed(2) : "0.00"} m</span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-muted">Heading:</span>
                    <span className="data text-telemetry font-semibold">
                      {frame?.th != null ? `${((frame.th * 180) / Math.PI).toFixed(0)}°` : "0°"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </Panel>
        </div>

        {/* Right Column: Teleoperation, Modes & Command Log */}
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
