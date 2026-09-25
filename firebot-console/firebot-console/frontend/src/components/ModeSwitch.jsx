import React, { useState } from "react";
import { PanelHeader } from "./TelemetryGauges.jsx";

const MODES = [
  { id: "idle", label: "Idle" },
  { id: "auto", label: "Auto" },
  { id: "manual", label: "Manual" },
  { id: "voice", label: "Voice" },
];

export default function ModeSwitch({ mode, onChange }) {
  const [pending, setPending] = useState(null);

  const request = (id) => {
    if (id === mode) return;
    setPending(id);
  };

  const confirm = () => {
    onChange(pending);
    setPending(null);
  };

  return (
    <div className="panel">
      <PanelHeader label="Mode" />
      <div className="border-t border-line grid grid-cols-4">
        {MODES.map((m, i) => {
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => request(m.id)}
              className={`py-3 text-[12px] font-mono transition-colors ${
                i !== 0 ? "border-l border-line" : ""
              } ${
                active
                  ? "bg-telemetry/10 text-telemetry"
                  : "text-muted hover:text-ink hover:bg-panel2"
              }`}
            >
              {m.label.toUpperCase()}
            </button>
          );
        })}
      </div>

      {pending && (
        <div className="border-t border-line px-4 py-3 flex items-center justify-between bg-panel2">
          <span className="text-[12px] text-muted">
            Switch to <span className="text-ink">{pending}</span>?
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPending(null)}
              className="text-[11px] font-mono text-muted hover:text-ink px-3 py-1 border border-line"
            >
              CANCEL
            </button>
            <button
              onClick={confirm}
              className="text-[11px] font-mono text-base bg-telemetry px-3 py-1 hover:brightness-110"
            >
              CONFIRM
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
