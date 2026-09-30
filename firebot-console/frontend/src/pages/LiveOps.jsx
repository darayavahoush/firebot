import React from "react";
import StatusStrip from "../components/StatusStrip.jsx";
import ThermalHero from "../components/ThermalHero.jsx";
import Ring from "../components/Ring.jsx";
import CameraFeed from "../components/CameraFeed.jsx";
import ControlPanel from "../components/ControlPanel.jsx";
import ModeSwitch from "../components/ModeSwitch.jsx";
import CommandLog from "../components/CommandLog.jsx";

export default function LiveOps({ frame, mode, setMode, log, onAnalog, onPump, onNozzle }) {
  const gas = Math.max(frame?.sensors?.mq2_front ?? 0, frame?.sensors?.mq2_rear ?? 0);
  const fix = frame?.est_sigma != null ? 1 - Math.min(frame.est_sigma, 4) / 4 : null;

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <StatusStrip frame={frame} mode={mode} logCount={log.length} />

      <div className="p-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px] items-start">
        {/* Left Column: Visual Telemetry, Optics & Vital Rings */}
        <div className="flex flex-col gap-6 min-w-0">
          {/* Main Thermal Imaging Station */}
          <ThermalHero frame={frame} />

          {/* Critical Gauges Bar */}
          <div className="panel p-5">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-line">
              <span className="text-[12px] font-mono uppercase tracking-wider text-muted font-medium flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-ok" />
                Vessel State & Environment Telemetry
              </span>
              <span className="text-[11px] font-mono text-faint">
                REAL-TIME SENSORS
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
                    <span className="text-telemetry font-bold">{frame?.th != null ? `${((frame.th * 180) / Math.PI).toFixed(0)}°` : "0°"}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Secondary Forward Camera Feed */}
          <div className="space-y-2">
            <CameraFeed frame={frame} />
            <p className="text-[11px] font-mono text-faint px-1">
              CAM-01 • Synthetic corridor & thermal target-lock overlay. Real hardware reports live telemetry over TCP socket.
            </p>
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
