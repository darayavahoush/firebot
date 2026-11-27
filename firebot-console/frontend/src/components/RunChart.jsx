import React from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { PanelHeader } from "./TelemetryGauges.jsx";

export default function RunChart({ runId, detail, cursorT }) {
  if (!runId) {
    return (
      <div className="panel h-full flex items-center justify-center min-h-[280px]">
        <span className="text-[12px] text-faint">
          Select a run to inspect
        </span>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="panel h-full flex items-center justify-center min-h-[280px]">
        <span className="text-[12px] text-faint">Loading telemetry…</span>
      </div>
    );
  }

  return (
    <div className="panel h-full flex flex-col">
      <PanelHeader label={`Run detail #${runId}`} />
      <div className="border-t border-line p-4 flex-1 min-h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={detail.points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="rgb(var(--c-line))" vertical={false} />
            <XAxis
              dataKey="t"
              tick={{ fill: "rgb(var(--c-muted))", fontSize: 10, fontFamily: "inherit" }}
              axisLine={{ stroke: "rgb(var(--c-line))" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "rgb(var(--c-muted))", fontSize: 10, fontFamily: "inherit" }}
              axisLine={{ stroke: "rgb(var(--c-line))" }}
              tickLine={false}
              width={32}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgb(var(--c-panel))",
                borderColor: "rgb(var(--c-line))",
                borderRadius: "8px",
                fontSize: 11,
                color: "rgb(var(--c-ink))",
                boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
              }}
              labelStyle={{ color: "rgb(var(--c-muted))" }}
            />
            <Line
              type="monotone"
              dataKey="est_sigma"
              stroke="rgb(var(--c-flame))"
              strokeWidth={1.75}
              dot={false}
              name="Fire Est. σ"
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="tank"
              stroke="rgb(var(--c-telemetry))"
              strokeWidth={1.75}
              dot={false}
              name="Tank"
            />
            {cursorT != null && <ReferenceLine x={cursorT} stroke="rgb(var(--c-ink))" strokeDasharray="3 3" />}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="border-t border-line px-4 py-2 flex gap-4 text-[11px] text-muted">
        <Legend color="rgb(var(--c-flame))" label="Fire est. σ (m)" />
        <Legend color="rgb(var(--c-telemetry))" label="Tank level" />
      </div>
    </div>
  );
}

function Legend({ color, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-[2.5px] w-[12px] rounded-full" style={{ background: color }} />
      <span>{label}</span>
    </div>
  );
}
