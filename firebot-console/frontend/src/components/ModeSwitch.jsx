import React, { useState } from "react";
import { playSound } from "../lib/sound.js";

const MODES = [
  { id: "idle", label: "Idle", hint: "Motors unpowered" },
  { id: "auto", label: "Auto", hint: "Flame search & suppress" },
  { id: "manual", label: "Manual", hint: "Teleop stick control" },
  { id: "voice", label: "Voice", hint: "Acoustic intents & SLM" },
];

export default function ModeSwitch({ mode, onChange }) {
  const [pending, setPending] = useState(null);

  const request = (id) => {
    if (id === mode) return;
    playSound("click");
    setPending(id);
  };

  const confirm = () => {
    playSound("ack");
    onChange(pending);
    setPending(null);
  };

  const cancel = () => {
    playSound("click");
    setPending(null);
  };

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-panel2/60 border-b border-line">
        <span className="panel-eyebrow">
          Operational mode selector
        </span>
        <span className="text-[12px] text-muted">
          Active: <b className="text-telemetry font-semibold capitalize">{mode}</b>
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-line">
        {MODES.map((m) => {
          const active = mode === m.id;
          const isPending = pending === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => request(m.id)}
              className={`p-3 text-left transition-colors cursor-pointer ${
                active
                  ? "bg-telemetry/10 text-telemetry"
                  : isPending
                  ? "bg-warn/15 text-warn"
                  : "text-muted hover:text-ink hover:bg-panel2/70"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold">
                  {m.label}
                </span>
                {active && <span className="h-1.5 w-1.5 rounded-full bg-telemetry" />}
              </div>
              <div className="text-[11px] text-faint truncate mt-0.5">{m.hint}</div>
            </button>
          );
        })}
      </div>

      {pending && (
        <div className="border-t border-warn/40 bg-warn/10 px-4 py-3 flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-2">
            <span className="text-warn text-[14px]">!</span>
            <span className="text-[12px] text-ink">
              Switch state to <b className="text-warn capitalize font-semibold">{pending}</b>?
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={cancel}
              className="text-[11px] text-muted hover:text-ink px-3 py-1 rounded-lg border border-line bg-panel2 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              className="text-[11px] font-semibold text-onaccent bg-warn hover:brightness-110 px-3 py-1 rounded-lg transition-colors cursor-pointer"
            >
              Confirm
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
