import React from "react";

export default function StatusStrip({ frame, mode, logCount }) {
  const computeMs = frame?.compute_ms;
  const isOnline = !!frame;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-line border-b border-line bg-panel/70 backdrop-blur-md">
      {/* System Status */}
      <div className="px-5 py-3 flex items-center justify-between">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-faint mb-1">Robot Link</div>
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${isOnline ? "bg-ok shadow-[0_0_8px_#7DE3B0]" : "bg-alarm pulse-dot"}`} />
            <span className={`text-[14px] font-display font-bold tracking-tight ${isOnline ? "text-ok" : "text-alarm"}`}>
              {isOnline ? "ONLINE & NOMINAL" : "CONNECTING..."}
            </span>
          </div>
        </div>
        <div className="hidden sm:flex gap-0.5 items-end h-4" title="Signal strength">
          <span className={`w-1 rounded-sm ${isOnline ? "h-2 bg-ok" : "h-1 bg-line"}`} />
          <span className={`w-1 rounded-sm ${isOnline ? "h-3 bg-ok" : "h-1 bg-line"}`} />
          <span className={`w-1 rounded-sm ${isOnline ? "h-4 bg-ok" : "h-1 bg-line"}`} />
        </div>
      </div>

      {/* Mode Status */}
      <div className="px-5 py-3">
        <div className="text-[11px] font-mono uppercase tracking-wider text-faint mb-1">Control Strategy</div>
        <div className="flex items-center gap-2">
          <span className="data text-[15px] font-bold text-ink uppercase tracking-wide">
            {mode}
          </span>
          <span className="text-[11px] text-faint font-mono">
            {mode === "auto" ? "• EIF & RRT*" : mode === "manual" ? "• Teleop Stick" : "• Standby"}
          </span>
        </div>
      </div>

      {/* Compute Performance */}
      <div className="px-5 py-3">
        <div className="text-[11px] font-mono uppercase tracking-wider text-faint mb-1">Perception Pipeline</div>
        <div className="flex items-baseline gap-2">
          <span className={`data text-[15px] font-bold ${computeMs && computeMs > 200 ? "text-warn" : "text-ink"}`}>
            {computeMs != null ? `${computeMs.toFixed(1)} ms` : "—"}
          </span>
          <span className="text-[11px] text-faint font-mono">
            {computeMs ? (computeMs < 100 ? "(optimal)" : "(elevated)") : "awaiting frame"}
          </span>
        </div>
      </div>

      {/* Commands Processed */}
      <div className="px-5 py-3 flex items-center justify-between">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-faint mb-1">Commands Dispatched</div>
          <div className="data text-[15px] font-bold text-telemetry">
            {logCount} <span className="text-[11px] font-mono text-faint font-normal">verified</span>
          </div>
        </div>
        <div className="text-[10px] font-mono px-2 py-1 rounded bg-panel2 text-muted border border-line">
          PORT 5000
        </div>
      </div>
    </div>
  );
}
