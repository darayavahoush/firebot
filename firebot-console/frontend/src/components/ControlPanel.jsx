import React, { useState } from "react";
import Joystick from "./Joystick.jsx";

export default function ControlPanel({ enabled, onAnalog, onPump, onNozzle }) {
  const [pumpOn, setPumpOn] = useState(false);
  const [nozzle, setNozzle] = useState(0);

  return (
    <div className="panel p-5">
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="font-display font-extrabold text-[18px] tracking-tight">Drive</h3>
        {!enabled && <span className="text-[12px] text-warn">Switch to Manual to drive</span>}
      </div>
      <div className={enabled ? "" : "pointer-events-none"}>
        <Joystick enabled={enabled} onMove={onAnalog} />
        <button
          onClick={() => { const n = !pumpOn; setPumpOn(n); onPump?.(n); }}
          disabled={!enabled} aria-pressed={pumpOn}
          className={`mt-5 w-full rounded-full py-3 text-[15px] font-medium border transition-colors disabled:opacity-40 ${pumpOn ? "border-warn text-warn bg-warn/10" : "border-line text-muted hover:text-ink"}`}
        >
          {pumpOn ? "Pump is spraying. Tap to stop" : "Pump is off. Tap to spray"}
        </button>
        <label className="block mt-4">
          <span className="flex justify-between text-[12px] text-muted mb-1"><span>Nozzle angle</span><span className="data text-ink">{nozzle}°</span></span>
          <input type="range" min={-45} max={45} value={nozzle} disabled={!enabled}
            onChange={(e) => { const v = Number(e.target.value); setNozzle(v); onNozzle?.(v); }}
            className="w-full accent-[#c4286f]" />
        </label>
        <p className="mt-3 text-[12px] text-faint">Arrow keys also drive at half speed. Space stops.</p>
      </div>
    </div>
  );
}
