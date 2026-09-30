import React, { useState } from "react";
import { playSound } from "../lib/sound.js";

const MODES = [
  { id: "idle", label: "IDLE", hint: "Motors unpowered" },
  { id: "auto", label: "AUTO", hint: "EIF flame search & suppress" },
  { id: "manual", label: "MANUAL", hint: "Teleop stick control" },
  { id: "voice", label: "VOICE", hint: "Acoustic intents & SLM" },
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
        <span className="text-[11px] font-mono uppercase tracking-wider text-muted font-medium">
          Operational Mode Selector
        </span>
        <span className="text-[10px] font-mono text-faint">
          ACTIVE: <b className="text-telemetry">{mode.toUpperCase()}</b>
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-line">
        {MODES.map((m) => {
          const active = mode === m.id;
          const isPending = pending === m.id;
          return (
            <button
              key={m.id}
              onClick={() => request(m.id)}
              className={`p-3 text-left transition-all duration-150 cursor-pointer ${
                active
                  ? "bg-telemetry/15 text-telemetry shadow-[inset_0_0_12px_rgba(240,85,155,0.2)]"
                  : isPending
                  ? "bg-warn/15 text-warn"
                  : "text-muted hover:text-ink hover:bg-panel2/70"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-mono font-bold tracking-wider">
                  {m.label}
                </span>
                {active && <span className="h-1.5 w-1.5 rounded-full bg-telemetry animate-pulse" />}
              </div>
              <div className="text-[10px] text-faint truncate mt-0.5">{m.hint}</div>
            </button>
          );
        })}
      </div>

      {pending && (
        <div className="border-t border-warn/40 bg-warn/10 px-4 py-3 flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-2">
            <span className="text-warn text-[14px]">⚠</span>
            <span className="text-[12px] text-ink font-mono">
              Switch state to <b className="text-warn uppercase font-bold">{pending}</b>?
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={cancel}
              className="text-[11px] font-mono text-muted hover:text-ink px-3 py-1 rounded-lg border border-line bg-panel2 transition-colors cursor-pointer"
            >
              CANCEL
            </button>
            <button
              onClick={confirm}
              className="text-[11px] font-mono font-bold text-[#0E0919] bg-warn hover:brightness-110 px-3 py-1 rounded-lg shadow-[0_0_10px_rgba(255,178,56,0.4)] transition-all cursor-pointer"
            >
              CONFIRM
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
