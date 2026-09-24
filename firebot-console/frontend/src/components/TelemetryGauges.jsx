import React from "react";

export default function TelemetryGauges({ frame }) {
  if (!frame) return <PanelSkeleton />;

  const battPct = Math.max(0, Math.min(100, ((frame.battery_v - 10.5) / (12.6 - 10.5)) * 100));
  const tempAlarm = frame.temp_c > 55;
  const gasAlarm = frame.gas_ppm > 25;

  return (
    <div className="panel">
      <PanelHeader label="Telemetry" />
      <div className="grid grid-cols-2 divide-x divide-line border-t border-line">
        <Metric label="Battery" value={frame.battery_v.toFixed(2)} unit="V" bar={battPct} />
        <Metric
          label="Core Temp"
          value={frame.temp_c.toFixed(1)}
          unit="°C"
          alarm={tempAlarm}
        />
      </div>
      <div className="grid grid-cols-2 divide-x divide-line border-t border-line">
        <Metric label="Gas" value={frame.gas_ppm.toFixed(1)} unit="ppm" alarm={gasAlarm} />
        <Metric
          label="Link Latency"
          value={frame.last_ack_ms}
          unit="ms"
          alarm={frame.last_ack_ms > 200}
        />
      </div>
      <div className="border-t border-line px-4 py-3 flex items-center justify-between">
        <span className="text-[12px] text-muted">Position</span>
        <span className="data text-[13px] text-ink">
          x {frame.pos.x.toFixed(2)}&nbsp;&nbsp;y {frame.pos.y.toFixed(2)}
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
