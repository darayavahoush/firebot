import React from "react";
import ThermalFrame from "../ThermalFrame.jsx";
import { PanelHeader } from "../TelemetryGauges.jsx";
import { US_ANGLES, FLAME_ANGLES } from "../../lib/simEngine.js";

const R = 78, CX = 154, CY = 100;
// Sim angles are counter-clockwise from the robot's nose; on screen "up" is forward.
const pt = (a, r) => [CX - Math.sin(a) * r, CY - Math.cos(a) * r];

function Sonar({ s }) {
  return (
    <svg viewBox="0 0 308 200" className="w-full" role="img" aria-label="Top-down view of the robot range and flame sensors">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <circle key={f} cx={CX} cy={CY} r={R * f} fill="none" stroke="rgb(var(--c-line2))" strokeDasharray={f === 1 ? "" : "3 4"} />
      ))}
      {Object.entries(FLAME_ANGLES).map(([k, a]) => {
        const v = s[k], [x, y] = pt(a, R + 16);
        return (
          <circle
            key={k}
            cx={x}
            cy={y}
            r={5 + v * 6}
            fill={v > 0.5 ? "rgb(var(--c-flame))" : "rgb(var(--c-warn))"}
            opacity={0.25 + v * 0.75}
          />
        );
      })}
      {Object.entries(US_ANGLES).map(([k, a]) => {
        const d = s[k], len = (Math.min(d, 4) / 4) * R, [x, y] = pt(a, len), [lx, ly] = pt(a, R + 4);
        const near = d < 0.6;
        return (
          <g key={k}>
            <line
              x1={CX}
              y1={CY}
              x2={x}
              y2={y}
              stroke={near ? "rgb(var(--c-alarm))" : "rgb(var(--c-telemetry))"}
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <circle
              cx={x}
              cy={y}
              r="4"
              fill={near ? "rgb(var(--c-alarm))" : "rgb(var(--c-telemetry))"}
            />
            <text x={lx} y={ly} textAnchor="middle" fontSize="10" className="data" fill="rgb(var(--c-muted))">
              {d.toFixed(1)}
            </text>
          </g>
        );
      })}
      <path d={`M${CX} ${CY - 10} L${CX + 8} ${CY + 8} L${CX - 8} ${CY + 8} Z`} fill="rgb(var(--c-ink))" />
    </svg>
  );
}

function Meter({ label, value, alarm }) {
  return (
    <div className="px-4 py-2.5">
      <div className="flex justify-between text-[12px] mb-1.5">
        <span className="text-muted">{label}</span>
        <span className={`data ${alarm ? "text-warn font-semibold" : "text-ink"}`}>{(value * 100).toFixed(0)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-line overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-200 ${alarm ? "bg-warn" : "bg-telemetry"}`}
          style={{ width: `${Math.min(100, value * 100)}%` }}
        />
      </div>
    </div>
  );
}

export default function SensorsTab({ t }) {
  const s = t.sense;
  if (!s) return <div className="px-4 py-6 text-[13px] text-faint">Waiting for the first sensor frame…</div>;
  const flame = Math.max(s.flame_left, s.flame_center, s.flame_right);

  return (
    <div>
      <PanelHeader
        label="Thermal sensor array"
        right={
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-[11px] font-medium text-telemetry">
              <span className={`h-1.5 w-1.5 rounded-full ${s.thermalLock ? "bg-alarm" : "bg-ok"}`} />
              {s.thermalLock ? "Heat lock" : "Sensing fire"}
            </span>
            <span className={`data text-[12px] font-semibold ${s.peakTemp > 45 ? "text-flame" : "text-muted"}`}>
              {s.peakTemp.toFixed(1)} °C
            </span>
          </div>
        }
      />
      <div className="px-4 pb-3">
        <ThermalFrame frame={s.thermal} width={308} height={231} />
        <div className="flex gap-1.5 mt-2 text-[11px] flex-wrap">
          <span className={`chip ${s.seen ? "!text-flame !border-flame/40 bg-flame/10 font-semibold" : ""}`}>
            {s.seen ? "Fire in FOV" : "Scanning sector"}
          </span>
          <span className="chip">
            FLIR mast: {(((s.mastPan || 0) * 180) / Math.PI).toFixed(0)}°
          </span>
          <span className="chip">
            Bearing: {((s.bearing * 180) / Math.PI).toFixed(0)}°
          </span>
        </div>
      </div>

      <PanelHeader label="Sonar & flame directions" right={<span className="text-[11px] text-faint">metres</span>} />
      <div className="px-4 pb-2 border-t border-line">
        <Sonar s={s} />
      </div>

      <PanelHeader label="Gas and flame readings" />
      <div className="border-t border-line divide-y divide-line">
        <Meter label="Gas, front (MQ-2)" value={s.mq2_front} alarm={s.mq2_front > 0.5} />
        <Meter label="Gas, rear (MQ-2)" value={s.mq2_rear} alarm={s.mq2_rear > 0.5} />
        <Meter label="Strongest flame sensor" value={flame} alarm={flame > 0.5} />
      </div>
    </div>
  );
}
