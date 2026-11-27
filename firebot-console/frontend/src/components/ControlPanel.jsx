import React, { useState } from "react";
import Joystick from "./Joystick.jsx";
import { playSound } from "../lib/sound.js";
import { Badge } from "./ui";

export default function ControlPanel({ enabled, onAnalog, onPump, onNozzle }) {
  const [pumpOn, setPumpOn] = useState(false);
  const [nozzle, setNozzle] = useState(0);

  const togglePump = () => {
    const next = !pumpOn;
    playSound("spray");
    setPumpOn(next);
    onPump?.(next);
  };

  const handleNozzleChange = (val) => {
    setNozzle(val);
    onNozzle?.(val);
  };

  return (
    <div className="panel p-5 space-y-5">
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-line pb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-[15px] font-semibold tracking-tight text-ink">
            Teleoperation deck
          </h3>
          <Badge tone={enabled ? "ok" : "neutral"} dot>
            {enabled ? "Engaged" : "Locked"}
          </Badge>
        </div>
        {!enabled && (
          <span className="text-[12px] text-warn">
            Select manual mode
          </span>
        )}
      </div>

      <div className={enabled ? "space-y-5" : "space-y-5 opacity-40 pointer-events-none select-none"}>
        {/* Joystick Station */}
        <div className="flex flex-col items-center">
          <div className="text-[12px] text-muted mb-3 flex items-center gap-2">
            <span>Analog differential stick</span>
            <span className="data text-[10px] text-faint border border-line px-1.5 py-0.5 rounded">
              500 ms watchdog
            </span>
          </div>
          <Joystick enabled={enabled} onMove={onAnalog} />
        </div>

        {/* Fire Suppression Pump Trigger */}
        <div className="pt-2 border-t border-line">
          <div className="flex items-center justify-between text-[12px] text-muted mb-2">
            <span>Water suppression actuator</span>
            <span className={pumpOn ? "text-telemetry font-semibold" : "text-faint"}>
              {pumpOn ? "Delivering 4.5 L/min @ 4.2 bar" : "Valve closed"}
            </span>
          </div>
          <button
            type="button"
            onClick={togglePump}
            disabled={!enabled}
            aria-pressed={pumpOn}
            className={`w-full py-2.5 px-4 rounded-lg text-[13px] font-semibold transition-colors flex items-center justify-center gap-2 border cursor-pointer ${
              pumpOn
                ? "bg-telemetry text-onaccent border-telemetry"
                : "bg-panel2 hover:bg-panel border-line text-ink hover:border-line2"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
            </svg>
            <span>{pumpOn ? "Stop spraying water" : "Dispense water jet"}</span>
          </button>
        </div>

        {/* Nozzle Turret Angle */}
        <div className="pt-2 border-t border-line space-y-2">
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-muted">Turret nozzle deflection</span>
            <span className="data font-semibold text-telemetry bg-panel2 px-2 py-0.5 rounded border border-line">
              {nozzle > 0 ? `+${nozzle}° right` : nozzle < 0 ? `${nozzle}° left` : "0° center"}
            </span>
          </div>

          <div className="relative">
            <input
              type="range"
              min={-45}
              max={45}
              value={nozzle}
              disabled={!enabled}
              onChange={(e) => handleNozzleChange(Number(e.target.value))}
              className="w-full accent-telemetry cursor-pointer bg-panel2 h-2 rounded-lg"
            />
            <div className="flex justify-between data text-[10px] text-faint mt-1">
              <span>-45° left</span>
              <span>0° center</span>
              <span>+45° right</span>
            </div>
          </div>
        </div>

        {/* Keyboard Teleop Hint */}
        <div className="p-3 rounded-lg bg-panel2/40 border border-line text-[11.5px] text-muted flex items-center gap-2">
          <span className="px-1.5 py-0.5 rounded bg-panel border border-line text-ink font-mono text-[10px]">▲ ▼ ◄ ►</span>
          <span>Drive at 50% speed.</span>
          <span className="px-1.5 py-0.5 rounded bg-panel border border-line text-ink font-mono text-[10px] ml-auto">[Space] Stop</span>
        </div>
      </div>
    </div>
  );
}
