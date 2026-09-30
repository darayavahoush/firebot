import React, { useState } from "react";
import Joystick from "./Joystick.jsx";
import { playSound } from "../lib/sound.js";

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
          <span className="font-display font-black text-[16px] tracking-tight text-ink">
            TELEOPERATION DECK
          </span>
          <span
            className={`text-[9px] font-mono px-2 py-0.5 rounded uppercase font-bold tracking-wider ${
              enabled
                ? "bg-ok/20 text-ok border border-ok/30"
                : "bg-warn/20 text-warn border border-warn/30"
            }`}
          >
            {enabled ? "ENGAGED" : "LOCKED"}
          </span>
        </div>
        {!enabled && (
          <span className="text-[11px] font-mono text-warn">
            Select Manual Mode
          </span>
        )}
      </div>

      <div className={enabled ? "space-y-5" : "space-y-5 opacity-40 pointer-events-none select-none"}>
        {/* Joystick Station */}
        <div className="flex flex-col items-center">
          <div className="text-[11px] font-mono uppercase tracking-wider text-muted mb-3 flex items-center gap-2">
            <span>Analog Differential Stick</span>
            <span className="text-[9px] text-faint border border-line px-1.5 py-0.5 rounded">
              0.5s WATCHDOG
            </span>
          </div>
          <Joystick enabled={enabled} onMove={onAnalog} />
        </div>

        {/* Fire Suppression Pump Trigger */}
        <div className="pt-2 border-t border-line">
          <div className="flex items-center justify-between text-[11px] font-mono uppercase text-muted mb-2">
            <span>Water Cannon Actuator</span>
            <span className={pumpOn ? "text-telemetry font-bold animate-pulse" : "text-faint"}>
              {pumpOn ? "PRESSURE 4.2 BAR" : "VALVE CLOSED"}
            </span>
          </div>
          <button
            onClick={togglePump}
            disabled={!enabled}
            aria-pressed={pumpOn}
            className={`w-full py-3.5 px-4 rounded-xl text-[14px] font-display font-extrabold tracking-wide uppercase transition-all duration-200 flex items-center justify-center gap-3 border cursor-pointer ${
              pumpOn
                ? "bg-gradient-to-r from-telemetry to-[#c4286f] text-white border-telemetry shadow-[0_0_20px_rgba(240,85,155,0.6)] animate-pulse"
                : "bg-panel2/80 hover:bg-panel2 border-line text-ink hover:border-telemetry/50"
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
            </svg>
            <span>{pumpOn ? "STOP SPRAYING WATER" : "DISPENSE WATER JET"}</span>
          </button>
        </div>

        {/* Nozzle Turret Angle */}
        <div className="pt-2 border-t border-line space-y-2">
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-muted font-medium">Turret Nozzle Deflection</span>
            <span className="data font-bold text-telemetry bg-panel2 px-2 py-0.5 rounded border border-line">
              {nozzle > 0 ? `+${nozzle}° R` : nozzle < 0 ? `${nozzle}° L` : "0° CENTER"}
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
            <div className="flex justify-between text-[10px] font-mono text-faint mt-1">
              <span>-45° (LEFT)</span>
              <span>0° (DEAD AHEAD)</span>
              <span>+45° (RIGHT)</span>
            </div>
          </div>
        </div>

        {/* Keyboard Teleop Hint */}
        <div className="p-3 rounded-xl bg-panel2/40 border border-line text-[11px] font-mono text-faint flex items-center gap-2">
          <span className="px-1.5 py-0.5 rounded bg-panel border border-line text-ink font-bold">▲ ▼ ◄ ►</span>
          <span>Drive at 50% speed.</span>
          <span className="px-1.5 py-0.5 rounded bg-panel border border-line text-ink font-bold ml-auto">[SPACE] STOP</span>
        </div>
      </div>
    </div>
  );
}
