import React, { useEffect, useMemo, useState } from "react";
import RunChart from "../components/RunChart.jsx";
import RunReplay from "../components/RunReplay.jsx";
import RunInsights from "../components/RunInsights.jsx";
import { fetchRuns, fetchRunDetail, fetchRunSummary, fetchRunAnomalies } from "../api/client.js";
import { playSound } from "../lib/sound.js";

const SORTS = {
  newest: { label: "Newest First", fn: (a, b) => new Date(b.started_at) - new Date(a.started_at) },
  longest: { label: "Longest Duration", fn: (a, b) => b.duration_s - a.duration_s },
  tank: { label: "Most Water Used", fn: (a, b) => (a.min_tank ?? 1) - (b.min_tank ?? 1) },
};

const FILTERS = {
  all: { label: "All Runs", fn: () => true },
  spray: { label: "Sprayed Water", fn: (r) => r.pumped },
  recon: { label: "Recon Only", fn: (r) => !r.pumped },
};

const dur = (s) => `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;

export default function History() {
  const [runs, setRuns] = useState([]);
  const [sel, setSel] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState("newest");
  const [filter, setFilter] = useState("all");
  const [summary, setSummary] = useState(null);
  const [anoms, setAnoms] = useState([]);
  const [cursorT, setCursorT] = useState(null);
  const [seek, setSeek] = useState(null);

  useEffect(() => {
    fetchRuns()
      .then((data) => {
        setRuns(data);
        if (data.length > 0 && !sel) setSel(data[0].id);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!sel) return;
    setDetail(null);
    setSummary(null);
    setAnoms([]);
    setSeek(null);
    fetchRunDetail(sel).then(setDetail);
    fetchRunSummary(sel).then(setSummary);
    fetchRunAnomalies(sel).then((r) => setAnoms(r?.anomalies ?? []));
  }, [sel]);

  const list = useMemo(() => {
    return runs
      .filter(FILTERS[filter].fn)
      .sort(SORTS[sort].fn);
  }, [runs, sort, filter]);

  const maxDur = Math.max(1, ...runs.map((r) => r.duration_s));
  const pumped = runs.filter((r) => r.pumped).length;
  const successRate = runs.length ? Math.round((pumped / runs.length) * 100) : 0;
  const median = runs.length
    ? [...runs].map((r) => r.duration_s).sort((a, b) => a - b)[Math.floor(runs.length / 2)]
    : 0;

  const run = runs.find((r) => r.id === sel);

  const selectRun = (id) => {
    playSound("click");
    setSel(id);
  };

  return (
    <div className="p-6 space-y-6 flex-1 overflow-y-auto">
      {/* Top Mission Analytics KPI Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="panel p-4 space-y-1">
          <div className="text-[11px] font-mono uppercase tracking-wider text-faint">
            Total Sorties
          </div>
          <div className="data text-[26px] font-display font-black text-ink">
            {loading ? "…" : runs.length}
            <span className="text-[12px] font-mono text-faint ml-1 font-normal">missions</span>
          </div>
        </div>

        <div className="panel p-4 space-y-1">
          <div className="text-[11px] font-mono uppercase tracking-wider text-faint">
            Suppression Rate
          </div>
          <div className="data text-[26px] font-display font-black text-ok">
            {loading ? "…" : `${successRate}%`}
            <span className="text-[12px] font-mono text-faint ml-1 font-normal">({pumped} sprayed)</span>
          </div>
        </div>

        <div className="panel p-4 space-y-1">
          <div className="text-[11px] font-mono uppercase tracking-wider text-faint">
            Median Mission Time
          </div>
          <div className="data text-[26px] font-display font-black text-telemetry">
            {loading ? "…" : dur(median)}
          </div>
        </div>

        <div className="panel p-4 space-y-1">
          <div className="text-[11px] font-mono uppercase tracking-wider text-faint">
            Archive Database
          </div>
          <div className="data text-[26px] font-display font-black text-ink flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-ok" />
            <span className="text-[16px] font-mono">POSTGRES</span>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr] items-start">
        {/* Left List Section */}
        <section aria-label="Sorties List" className="space-y-3">
          {/* Controls: Filter & Sort */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 bg-panel2 p-1 rounded-xl border border-line" role="group" aria-label="Filter runs">
              {Object.entries(FILTERS).map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => { playSound("click"); setFilter(k); }}
                  className={`flex-1 py-1 text-[11px] font-mono rounded-lg transition-all ${
                    filter === k
                      ? "bg-telemetry text-base font-bold shadow-[0_0_8px_rgba(240,85,155,0.4)]"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5 bg-panel p-1 rounded-xl border border-line" role="group" aria-label="Sort runs">
              {Object.entries(SORTS).map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => { playSound("click"); setSort(k); }}
                  className={`flex-1 py-1 text-[10px] font-mono rounded-lg transition-all ${
                    sort === k
                      ? "bg-panel2 text-ink font-bold border border-telemetry/40"
                      : "text-faint hover:text-ink border border-transparent"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          {/* List of Runs */}
          <div className="flex flex-col gap-2 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
            {loading && <div className="text-muted text-[13px] font-mono py-8 text-center">Loading archives…</div>}
            {!loading && list.length === 0 && (
              <div className="p-8 text-center text-faint font-mono text-[13px] panel">
                No sorties found matching this criteria.
              </div>
            )}
            {list.map((r) => {
              const active = sel === r.id;
              return (
                <button
                  key={r.id}
                  onClick={() => selectRun(r.id)}
                  aria-pressed={active}
                  className={`w-full text-left rounded-xl p-3.5 border transition-all duration-150 cursor-pointer ${
                    active
                      ? "border-telemetry bg-gradient-to-r from-telemetry/15 to-panel2/80 shadow-[0_0_16px_rgba(240,85,155,0.25)]"
                      : "border-line bg-panel hover:bg-panel2/70 hover:border-line/90"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display font-bold text-[13px] text-ink">
                      {new Date(r.started_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span
                      className={`text-[9px] font-mono px-2 py-0.5 rounded font-bold uppercase ${
                        r.pumped
                          ? "bg-ok/20 text-ok border border-ok/30"
                          : "bg-panel2 text-faint border border-line"
                      }`}
                    >
                      {r.pumped ? "SUPPRESSION" : "RECON"}
                    </span>
                  </div>

                  {/* Duration Heatbar */}
                  <div className="mt-2.5 h-[5px] rounded-full bg-panel2 overflow-hidden border border-line/40">
                    <div
                      className="heatbar h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.max(6, (r.duration_s / maxDur) * 100)}%`,
                        "--full": `${(maxDur / r.duration_s) * 100}%`,
                      }}
                    />
                  </div>

                  <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-muted">
                    <span className="text-ink font-bold">{dur(r.duration_s)}</span>
                    <span className="text-faint">{r.frames} frames • {r.operator_commands} cmds</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Right Detail Section */}
        <section aria-label="Sortie Deep Dive" className="min-w-0">
          {run ? (
            <div className="space-y-6">
              {/* Run Header Banner */}
              <div className="panel p-5">
                <div className="flex items-center justify-between flex-wrap gap-2 pb-3 mb-3 border-b border-line">
                  <div className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-ok" />
                    <h2 className="font-display font-black text-[22px] tracking-tight text-ink">
                      Sortie on {run.robot}
                    </h2>
                  </div>
                  <div className="text-[11px] font-mono text-faint bg-panel2 px-2.5 py-1 rounded-lg border border-line">
                    SESSION #{run.id}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px] font-mono">
                  <div className="p-2.5 rounded-lg bg-panel2/60 border border-line">
                    <span className="text-faint text-[10px] uppercase block">Start Time</span>
                    <span className="text-ink font-bold">
                      {new Date(run.started_at).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-panel2/60 border border-line">
                    <span className="text-faint text-[10px] uppercase block">Duration</span>
                    <span className="text-ink font-bold">{dur(run.duration_s)}</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-panel2/60 border border-line">
                    <span className="text-faint text-[10px] uppercase block">Final Tank</span>
                    <span className="text-telemetry font-bold">
                      {run.min_tank != null ? `${(run.min_tank * 100).toFixed(0)}%` : "Unknown"}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-panel2/60 border border-line">
                    <span className="text-faint text-[10px] uppercase block">Water Dispensed</span>
                    <span className={run.pumped ? "text-ok font-bold" : "text-faint font-bold"}>
                      {run.pumped ? "YES (FIRE OUT)" : "NONE"}
                    </span>
                  </div>
                </div>
              </div>

              {detail && (
                <div className="space-y-6">
                  {/* Replay Scrubbing Station */}
                  <RunReplay
                    points={detail.points}
                    anomalies={anoms}
                    seek={seek}
                    onT={setCursorT}
                  />

                  {/* Telemetry Chart */}
                  <div className="panel p-4 h-[320px]">
                    <div className="text-[11px] font-mono uppercase tracking-wider text-faint mb-2">
                      Certainty & Water Tank Telemetry Curves
                    </div>
                    <div className="h-[270px]">
                      <RunChart runId={sel} detail={detail} cursorT={cursorT} />
                    </div>
                  </div>

                  {/* AI & Statistical Insights */}
                  <RunInsights summary={summary} anomalies={anoms} onSeek={setSeek} />
                </div>
              )}

              {!detail && (
                <div className="panel p-12 text-center text-muted font-mono text-[14px]">
                  Extracting sensor timeseries from telemetry archive…
                </div>
              )}
            </div>
          ) : (
            <div className="panel p-16 text-center text-faint font-mono text-[14px]">
              Select a sortie from the archive to inspect its telemetry, anomalies, and playback.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
