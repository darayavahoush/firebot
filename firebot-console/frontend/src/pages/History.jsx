import React, { useEffect, useMemo, useState } from "react";
import RunChart from "../components/RunChart.jsx";
import { fetchRuns, fetchRunDetail } from "../api/client.js";

const SORTS = {
  newest: { label: "Newest", fn: (a, b) => new Date(b.started_at) - new Date(a.started_at) },
  longest: { label: "Longest", fn: (a, b) => b.duration_s - a.duration_s },
  tank: { label: "Most water used", fn: (a, b) => a.min_tank - b.min_tank },
};
const dur = (s) => `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;

export default function History() {
  const [runs, setRuns] = useState([]);
  const [sel, setSel] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState("newest");

  useEffect(() => { fetchRuns().then(setRuns).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    if (!sel) return;
    setDetail(null);
    fetchRunDetail(sel).then(setDetail);
  }, [sel]);

  const list = useMemo(() => [...runs].sort(SORTS[sort].fn), [runs, sort]);
  const maxDur = Math.max(1, ...runs.map((r) => r.duration_s));
  const pumped = runs.filter((r) => r.pumped).length;
  const median = runs.length ? [...runs].map((r) => r.duration_s).sort((a, b) => a - b)[Math.floor(runs.length / 2)] : 0;
  const run = runs.find((r) => r.id === sel);

  return (
    <div className="p-6 grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr] items-start">
      <section aria-label="Runs">
        <p className="font-display text-[22px] leading-snug tracking-tight max-w-[36ch]">
          {loading ? "Loading runs…" : runs.length === 0 ? "No runs logged yet. Start the brain and the robot, then come back." : (
            <>The robot has logged <b className="text-telemetry">{runs.length} runs</b>. It sprayed water in <b className="text-telemetry">{pumped}</b> of them, and the typical run lasts <b className="text-telemetry">{dur(median)}</b>.</>
          )}
        </p>
        <div className="flex gap-2 mt-5 mb-3" role="group" aria-label="Sort runs">
          {Object.entries(SORTS).map(([k, v]) => (
            <button key={k} className="chip" data-on={sort === k} onClick={() => setSort(k)}>{v.label}</button>
          ))}
        </div>
        <ul className="flex flex-col gap-1.5">
          {list.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => setSel(r.id)}
                aria-pressed={sel === r.id}
                className={`w-full text-left rounded-[10px] px-4 py-3 border transition-colors ${sel === r.id ? "border-telemetry bg-panel2" : "border-transparent hover:bg-panel"}`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{new Date(r.started_at).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  <span className={`text-[12px] ${r.pumped ? "text-ok" : "text-faint"}`}>{r.pumped ? "Sprayed water" : "No spray"}</span>
                </div>
                <div className="mt-2 h-[6px] rounded-full bg-line overflow-hidden">
                  <div className="heatbar h-full rounded-full" style={{ width: `${(r.duration_s / maxDur) * 100}%`, "--full": `${(maxDur / r.duration_s) * 100}%` }} />
                </div>
                <div className="mt-1.5 text-[12px] text-muted data">{dur(r.duration_s)} · {r.frames} frames · {r.operator_commands} commands</div>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Run detail" className="lg:sticky lg:top-4">
        {run ? (
          <>
            <h2 className="font-display font-extrabold text-[26px] tracking-tight">{new Date(run.started_at).toLocaleDateString(undefined, { day: "numeric", month: "long" })}, {dur(run.duration_s)} on {run.robot}</h2>
            <p className="text-muted text-[14px] mt-1 mb-4 max-w-[60ch]">
              The tank ended at {run.min_tank != null ? `${(run.min_tank * 100).toFixed(0)}%` : "an unknown level"}. The pink line is the water tank; the amber line is how uncertain the robot was about where the fire is. When amber falls, the robot has found it.
            </p>
          </>
        ) : (
          <p className="text-muted text-[15px] max-w-[46ch] py-10">Pick a run on the left to see its tank level and fire-location certainty over time.</p>
        )}
        <div className="h-[380px]"><RunChart runId={sel} detail={detail} /></div>
      </section>
    </div>
  );
}
