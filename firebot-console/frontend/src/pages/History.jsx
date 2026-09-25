import React, { useEffect, useState } from "react";
import RunHistoryTable from "../components/RunHistoryTable.jsx";
import RunChart from "../components/RunChart.jsx";
import { fetchRuns, fetchRunDetail } from "../api/client.js";

export default function History() {
  const [runs, setRuns] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRuns()
      .then(setRuns)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setDetail(null);
    fetchRunDetail(selectedId).then(setDetail);
  }, [selectedId]);

  return (
    <div className="p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display font-bold text-[15px] text-ink tracking-wide">
          Run History
        </h1>
        <span className="text-[11px] font-mono text-faint">
          {loading ? "loading…" : `${runs.length} runs logged`}
        </span>
      </div>

      <RunHistoryTable
        runs={runs}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />

      <RunChart runId={selectedId} detail={detail} />
    </div>
  );
}
