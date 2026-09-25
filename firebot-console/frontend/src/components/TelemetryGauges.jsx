import React from "react";

// Peak temperature (°C) found in a 24x32 thermal grid, or null if no grid.
function thermalPeak(thermal) {
  if (!thermal) return null;
  let peak = -Infinity;
  for (const row of thermal) for (const v of row) if (v > peak) peak = v;
  return Number.isFinite(peak) ? peak : null;
}

export default function TelemetryGauges({ frame }) {
  if (!frame) return <PanelSkeleton />;

  const tankPct = Math.max(0, Math.min(100, frame.tank * 100));
  const peak = thermalPeak(frame.thermal);
  const tempAlarm = peak != null && peak > 55;
  const gasLevel = Math.max(frame.sensors?.mq2_front ?? 0, frame.sensors?.mq2_rear ?? 0);
  const gasPct = Math.max(0, Math.min(100, gasLevel * 100));
  const gasAlarm = gasPct > 25;

  return (
    <div className="panel">
      <PanelHeader label="Telemetry" />
      <div className="grid grid-cols-2 divide-x divide-line border-t border-line">
        <Metric label="Tank" value={tankPct.toFixed(0)} unit="%" bar={tankPct} />
        <Metric
          label="Peak Thermal"
          value={peak != null ? peak.toFixed(1) : "—"}
          unit="°C"
          alarm={tempAlarm}
        />
      </div>
      <div className="grid grid-cols-2 divide-x divide-line border-t border-line">
        <Metric label="Gas" value={gasPct.toFixed(1)} unit="%" alarm={gasAlarm} />
        <Metric
          label="Compute"
          value={frame.compute_ms != null ? frame.compute_ms.toFixed(1) : "—"}
          unit="ms"
          alarm={frame.compute_ms > 200}
        />
      </div>
      <div className="border-t border-line px-4 py-3 flex items-center justify-between">
        <span className="text-[12px] text-muted">Position</span>
        <span className="data text-[13px] text-ink">
          x {frame.x.toFixed(2)}&nbsp;&nbsp;y {frame.y.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

function Metric({ label, value, unit, bar, alarm }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[11px] text-muted mb-1.5">{label}</div>
      <div className="flex items-baseline gap-1">
        <span
          className={`data text-[22px] leading-none ${
            alarm ? "text-warn" : "text-ink"
          }`}
        >
          {value}
        </span>
        <span className="text-[11px] text-faint">{unit}</span>
      </div>
      {typeof bar === "number" && (
        <div className="mt-2 h-[3px] bg-line w-full">
          <div
            className={`h-full ${bar < 25 ? "bg-warn" : "bg-telemetry"}`}
            style={{ width: `${bar}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function PanelHeader({ label, right }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-[11px] tracking-wide text-muted">{label}</span>
      {right}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="panel h-[186px] flex items-center justify-center">
      <span className="text-[12px] text-faint font-mono">connecting…</span>
    </div>
  );
}
