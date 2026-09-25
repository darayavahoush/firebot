import React, { useState } from "react";
import { PanelHeader } from "./TelemetryGauges.jsx";

const DIRECTIONS = [
  { id: "fwd", label: "▲", row: 1, col: 2 },
  { id: "left", label: "◀", row: 2, col: 1 },
  { id: "stop", label: "●", row: 2, col: 2 },
  { id: "right", label: "▶", row: 2, col: 3 },
  { id: "back", label: "▼", row: 3, col: 2 },
];

export default function ControlPanel({ enabled, onDrive, onPump, onNozzle }) {
  const [speed, setSpeed] = useState(50);
  const [pumpOn, setPumpOn] = useState(false);
  const [nozzle, setNozzle] = useState(0);
  const [activeDir, setActiveDir] = useState(null);

  const drive = (dir) => {
    if (!enabled) return;
    setActiveDir(dir);
    onDrive?.({ dir, speed });
    window.setTimeout(() => setActiveDir(null), 180);
  };

  const togglePump = () => {
    if (!enabled) return;
    const next = !pumpOn;
    setPumpOn(next);
    onPump?.(next);
  };

  const changeNozzle = (val) => {
    setNozzle(val);
    onNozzle?.(val);
  };

  return (
    <div className={`panel ${!enabled ? "opacity-50 pointer-events-none" : ""}`}>
      <PanelHeader
        label="Manual Control"
        right={
          !enabled && (
            <span className="font-mono text-[10px] text-faint">
              SWITCH TO MANUAL
            </span>
          )
        }
      />
      <div className="border-t border-line grid grid-cols-2">
        {/* Drive pad */}
        <div className="p-4 border-r border-line flex flex-col items-center gap-4">
          <div className="grid grid-cols-3 grid-rows-3 gap-1.5 w-[136px]">
            {[1, 2, 3].map((row) =>
              [1, 2, 3].map((col) => {
                const d = DIRECTIONS.find((x) => x.row === row && x.col === col);
                if (!d) return <div key={`${row}-${col}`} />;
                const isStop = d.id === "stop";
                return (
                  <button
                    key={d.id}
                    onClick={() => drive(d.id)}
                    className={`h-10 w-10 flex items-center justify-center text-[13px] border transition-colors ${
                      activeDir === d.id
                        ? "bg-telemetry text-base border-telemetry"
                        : isStop
                        ? "border-alarm/50 text-alarm hover:bg-alarm/10"
                        : "border-line text-muted hover:text-ink hover:border-faint"
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })
            )}
          </div>

          <div className="w-full">
            <div className="flex items-center justify-between text-[11px] text-muted mb-1">
              <span>Speed</span>
              <span className="data text-ink">{speed}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="w-full accent-telemetry"
            />
          </div>
        </div>

        {/* Extinguisher controls */}
        <div className="p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted">Pump</span>
            <button
              onClick={togglePump}
              className={`font-mono text-[11px] px-3 py-1.5 border transition-colors ${
                pumpOn
                  ? "border-warn text-warn bg-warn/10"
                  : "border-line text-muted hover:text-ink"
              }`}
            >
              {pumpOn ? "ON" : "OFF"}
            </button>
          </div>

          <div>
            <div className="flex items-center justify-between text-[11px] text-muted mb-1">
              <span>Nozzle angle</span>
              <span className="data text-ink">{nozzle}°</span>
            </div>
            <input
              type="range"
              min={-45}
              max={45}
              value={nozzle}
              onChange={(e) => changeNozzle(Number(e.target.value))}
              className="w-full accent-telemetry"
            />
          </div>

          <div className="mt-auto pt-2 border-t border-line text-[10px] text-faint font-mono leading-relaxed">
            Arrow keys drive · Space stops · P toggles pump
          </div>
        </div>
      </div>
    </div>
  );
}
