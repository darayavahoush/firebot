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
            <CartesianGrid stroke="#262E35" vertical={false} />
            <XAxis
              dataKey="t"
              tick={{ fill: "#5C6871", fontSize: 10, fontFamily: "IBM Plex Mono" }}
              axisLine={{ stroke: "#262E35" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#5C6871", fontSize: 10, fontFamily: "IBM Plex Mono" }}
              axisLine={{ stroke: "#262E35" }}
              tickLine={false}
              width={32}
            />
            <Tooltip
              contentStyle={{
                background: "#1C232A",
                border: "1px solid #262E35",
                fontFamily: "IBM Plex Mono",
                fontSize: 11,
                color: "#E7EDF2",
              }}
              labelStyle={{ color: "#8A97A3" }}
            />
            <Line
              type="monotone"
              dataKey="temp_c"
              stroke="#F5A623"
              strokeWidth={1.5}
              dot={false}
              name="Temp °C"
            />
            <Line
              type="monotone"
              dataKey="battery_v"
              stroke="#3FA7D6"
              strokeWidth={1.5}
              dot={false}
              name="Battery V"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="border-t border-line px-4 py-2 flex gap-4 font-mono text-[10px] text-muted">
        <Legend color="#F5A623" label="Temp °C" />
        <Legend color="#3FA7D6" label="Battery V" />
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
