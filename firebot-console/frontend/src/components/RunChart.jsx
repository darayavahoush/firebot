import React from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { PanelHeader } from "./TelemetryGauges.jsx";

export default function RunChart({ runId, detail }) {
  if (!runId) {
    return (
      <div className="panel h-full flex items-center justify-center min-h-[280px]">
        <span className="font-mono text-[12px] text-faint">
          Select a run to inspect
        </span>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="panel h-full flex items-center justify-center min-h-[280px]">
        <span className="font-mono text-[12px] text-faint">loading…</span>
      </div>
    );
  }

  return (
    <div className="panel h-full flex flex-col">
      <PanelHeader label={`Run Detail — ${runId}`} />
      <div className="border-t border-line p-4 flex-1 min-h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={detail.points} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="rgba(232,236,239,0.14)" vertical={false} />
            <XAxis
              dataKey="t"
              tick={{ fill: "rgba(232,236,239,0.4)", fontSize: 10, fontFamily: "JetBrains Mono" }}
              axisLine={{ stroke: "rgba(232,236,239,0.14)" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "rgba(232,236,239,0.4)", fontSize: 10, fontFamily: "JetBrains Mono" }}
              axisLine={{ stroke: "rgba(232,236,239,0.14)" }}
              tickLine={false}
              width={32}
            />
            <Tooltip
              contentStyle={{
                background: "#12171B",
                border: "1px solid rgba(232,236,239,0.14)",
                fontFamily: "JetBrains Mono",
                fontSize: 11,
                color: "#E8ECEF",
              }}
              labelStyle={{ color: "rgba(232,236,239,0.6)" }}
            />
            <Line
              type="monotone"
              dataKey="est_sigma"
              stroke="#FFB000"
              strokeWidth={1.5}
              dot={false}
              name="Fire Est. σ"
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="tank"
              stroke="#4AC7EC"
              strokeWidth={1.5}
              dot={false}
              name="Tank"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="border-t border-line px-4 py-2 flex gap-4 font-mono text-[10px] text-muted">
        <Legend color="#FFB000" label="Fire Est. σ" />
        <Legend color="#4AC7EC" label="Tank" />
      </div>
    </div>
  );
}

function Legend({ color, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-[2px] w-[10px]" style={{ background: color }} />
      {label}
    </div>
  );
}
