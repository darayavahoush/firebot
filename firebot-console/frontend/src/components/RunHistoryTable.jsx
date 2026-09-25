import React, { useMemo, useState } from "react";

const COLUMNS = [
  { key: "id", label: "Run" },
  { key: "robot", label: "Robot" },
  { key: "started_at", label: "Started" },
  { key: "duration_s", label: "Duration" },
  { key: "frames", label: "Frames" },
  { key: "min_tank", label: "Min Tank" },
  { key: "operator_commands", label: "Operator Cmds" },
  { key: "pumped", label: "Result" },
];

export default function RunHistoryTable({ runs, selectedId, onSelect }) {
  const [sortKey, setSortKey] = useState("started_at");
  const [sortDir, setSortDir] = useState("desc");

  const sorted = useMemo(() => {
    const copy = [...runs];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [runs, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  return (
    <div className="panel overflow-x-auto">
      <table className="w-full text-[12px] font-mono border-collapse">
        <thead>
          <tr className="border-b border-line">
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                onClick={() => toggleSort(col.key)}
                className="text-left px-4 py-2.5 text-muted font-normal cursor-pointer select-none hover:text-ink whitespace-nowrap"
              >
                {col.label}
                {sortKey === col.key && (
                  <span className="text-faint ml-1">
                    {sortDir === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((run) => (
            <tr
              key={run.id}
              onClick={() => onSelect(run.id)}
              className={`border-b border-line/60 last:border-0 cursor-pointer transition-colors ${
                selectedId === run.id
                  ? "bg-telemetry/10"
                  : "hover:bg-panel2"
              }`}
            >
              <td className="px-4 py-2.5 text-ink">{run.id}</td>
              <td className="px-4 py-2.5 text-muted whitespace-nowrap">{run.robot}</td>
              <td className="px-4 py-2.5 text-muted whitespace-nowrap">
                {new Date(run.started_at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </td>
              <td className="px-4 py-2.5 text-muted">
                {formatDuration(run.duration_s)}
              </td>
              <td className="px-4 py-2.5 text-muted">{run.frames}</td>
              <td className="px-4 py-2.5 text-muted">
                {run.min_tank != null ? `${(run.min_tank * 100).toFixed(0)}%` : "—"}
              </td>
              <td className="px-4 py-2.5 text-muted">{run.operator_commands}</td>
              <td className="px-4 py-2.5">
                <ResultBadge pumped={run.pumped} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultBadge({ pumped }) {
  return (
    <span
      className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] border ${
        pumped
          ? "border-ok/40 text-ok"
          : "border-line text-faint"
      }`}
    >
      {pumped ? "PUMPED" : "NO PUMP"}
    </span>
  );
}

function formatDuration(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec.toString().padStart(2, "0")}s`;
}
