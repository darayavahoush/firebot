import React, { useCallback, useEffect, useMemo, useState } from "react";
import RunChart from "../components/RunChart.jsx";
import RunReplay from "../components/RunReplay.jsx";
import RunInsights from "../components/RunInsights.jsx";
import { fetchRuns, fetchRunDetail, fetchRunSummary, fetchRunAnomalies, seedRuns } from "../api/client.js";
import { playSound } from "../lib/sound.js";
import { Stat, Badge, Button, EmptyState, Panel } from "../components/ui";

const SORTS = {
  newest: { label: "Newest first", fn: (a, b) => new Date(b.started_at) - new Date(a.started_at) },
  longest: { label: "Longest duration", fn: (a, b) => b.duration_s - a.duration_s },
  tank: { label: "Most water used", fn: (a, b) => (a.min_tank ?? 1) - (b.min_tank ?? 1) },
};

const FILTERS = {
  all: { label: "All runs", fn: () => true },
  spray: { label: "Sprayed water", fn: (r) => r.pumped },
  recon: { label: "Recon only", fn: (r) => !r.pumped },
};

const dur = (s) => `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;

export default function History() {
  const [runs, setRuns] = useState([]);
  const [sel, setSel] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [seeding, setSeeding] = useState(false);
  const [sort, setSort] = useState("newest");
  const [filter, setFilter] = useState("all");
  const [summary, setSummary] = useState(null);
  const [anoms, setAnoms] = useState([]);
  const [cursorT, setCursorT] = useState(null);
  const [seek, setSeek] = useState(null);

  const loadRuns = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      let data = await fetchRuns();
      if (!data || data.length === 0) {
        try {
          await seedRuns();
          data = await fetchRuns();
        } catch (e) {
          console.warn("Auto-seed fallback warning", e);
        }
      }
      setRuns(data || []);
      if (data && data.length > 0) {
        setSel((prev) => (prev && data.some((r) => r.id === prev) ? prev : data[0].id));
      }
    } catch (err) {
      console.error("Failed to load runs", err);
      setError(err.message || "Failed to connect to archive database.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  const handleManualSeed = async () => {
    playSound("click");
    setSeeding(true);
    try {
      await seedRuns();
      await loadRuns();
    } catch (err) {
      alert("Failed to seed runs: " + err.message);
    } finally {
      setSeeding(false);
    }
  };

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

  if (error && runs.length === 0) {
    return (
      <div className="p-6 flex-1 flex items-center justify-center">
        <EmptyState
          illustration="error-generic"
          title="Could not load run archives"
          description={error}
          action={<Button variant="primary" onClick={loadRuns}>Retry connection</Button>}
        />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 flex-1 overflow-y-auto">
      {/* Top Mission Analytics KPI Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="panel p-4">
          <Stat
            label="Total sorties"
            value={loading ? "…" : `${runs.length}`}
            hint="Recorded missions in database"
          />
        </div>

        <div className="panel p-4">
          <Stat
            label="Suppression rate"
            value={loading ? "…" : `${successRate}%`}
            hint={`${pumped} sorties extinguished fires`}
          />
        </div>

        <div className="panel p-4">
          <Stat
            label="Median mission time"
            value={loading ? "…" : dur(median)}
            hint="Typical operational duration"
          />
        </div>

        <div className="panel p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted font-medium">Archive database</span>
            <button
              type="button"
              onClick={handleManualSeed}
              disabled={seeding}
              className="text-[11px] text-telemetry hover:underline cursor-pointer"
            >
              {seeding ? "Seeding…" : "Re-seed"}
            </button>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <span className="h-2 w-2 rounded-full bg-ok" />
            <span className="data text-[18px] font-semibold text-ink">PostgreSQL</span>
          </div>
          <span className="text-[11px] text-faint mt-1">Render managed persistence</span>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr] items-start">
        {/* Left List Section */}
        <section aria-label="Sorties list" className="space-y-3">
          {/* Controls: Filter & Sort */}
          <div className="space-y-2">
            <div className="flex items-center gap-1 bg-panel2 p-0.5 rounded-lg border border-line" role="group" aria-label="Filter runs">
              {Object.entries(FILTERS).map(([k, v]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => { playSound("click"); setFilter(k); }}
                  className={`flex-1 py-1 text-[11.5px] rounded-md transition-colors ${
                    filter === k
                      ? "bg-panel text-ink font-semibold shadow-sm"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 bg-panel p-0.5 rounded-lg border border-line" role="group" aria-label="Sort runs">
              {Object.entries(SORTS).map(([k, v]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => { playSound("click"); setSort(k); }}
                  className={`flex-1 py-1 text-[11px] rounded-md transition-colors ${
                    sort === k
                      ? "bg-panel2 text-ink font-semibold"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          {/* List of Runs */}
          <div className="flex flex-col gap-2 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
            {loading && <div className="text-muted text-[13px] py-8 text-center">Loading archives…</div>}
            {!loading && list.length === 0 && (
              <EmptyState
                illustration="empty-history"
                title="No sorties found in archives"
                description="No recorded missions match the current filter."
                action={
                  <Button variant="primary" onClick={handleManualSeed} disabled={seeding}>
                    {seeding ? "Generating mission telemetry…" : "+ Seed sortie archive"}
                  </Button>
                }
              />
            )}
            {list.map((r) => {
              const active = sel === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => selectRun(r.id)}
                  aria-pressed={active}
                  className={`w-full text-left rounded-lg p-3 border transition-colors cursor-pointer ${
                    active
                      ? "border-flame/40 bg-panel2"
                      : "border-line bg-panel hover:bg-panel2/60 hover:border-line2"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[13px] text-ink">
                      {new Date(r.started_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <Badge tone={r.pumped ? "ok" : "neutral"} dot>
                      {r.pumped ? "Suppression" : "Recon"}
                    </Badge>
                  </div>

                  {/* Duration Heatbar */}
                  <div className="mt-2.5 h-1 rounded-full bg-panel2 overflow-hidden border border-line">
                    <div
                      className="heatbar h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.max(6, (r.duration_s / maxDur) * 100)}%`,
                        "--full": `${(maxDur / r.duration_s) * 100}%`,
                      }}
                    />
                  </div>

                  <div className="mt-2 flex items-center justify-between text-[11.5px] text-muted">
                    <span className="data text-ink font-medium">{dur(r.duration_s)}</span>
                    <span className="data text-faint">{r.frames} frames • {r.operator_commands} cmds</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Right Detail Section */}
        <section aria-label="Sortie deep dive" className="min-w-0 space-y-5">
          {run ? (
            <div className="space-y-5">
              {/* Run Header Banner */}
              <div className="panel p-5">
                <div className="flex items-center justify-between flex-wrap gap-2 pb-3 mb-3 border-b border-line">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-ok" />
                    <h2 className="text-[17px] font-semibold text-ink">
                      Sortie on {run.robot}
                    </h2>
                  </div>
                  <div className="data text-[11px] text-faint bg-panel2 px-2.5 py-1 rounded-md border border-line">
                    Session #{run.id}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px]">
                  <div className="p-2.5 rounded-lg bg-panel2/60 border border-line">
                    <span className="text-faint text-[10.5px] uppercase block">Start time</span>
                    <span className="data text-ink font-semibold">
                      {new Date(run.started_at).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-panel2/60 border border-line">
                    <span className="text-faint text-[10.5px] uppercase block">Duration</span>
                    <span className="data text-ink font-semibold">{dur(run.duration_s)}</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-panel2/60 border border-line">
                    <span className="text-faint text-[10.5px] uppercase block">Final tank</span>
                    <span className="data text-telemetry font-semibold">
                      {run.min_tank != null ? `${(run.min_tank * 100).toFixed(0)}%` : "Unknown"}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-panel2/60 border border-line">
                    <span className="text-faint text-[10.5px] uppercase block">Water delivery</span>
                    <span className={`data font-semibold ${run.pumped ? "text-ok" : "text-muted"}`}>
                      {run.pumped ? "Dispensed (fire out)" : "None"}
                    </span>
                  </div>
                </div>
              </div>

              {detail ? (
                <div className="space-y-5">
                  {/* Replay Scrubbing Station */}
                  <RunReplay
                    points={detail.points}
                    anomalies={anoms}
                    seek={seek}
                    onT={setCursorT}
                  />

                  {/* Telemetry Chart */}
                  <div className="h-[320px]">
                    <RunChart runId={sel} detail={detail} cursorT={cursorT} />
                  </div>

                  {/* Insights & Anomaly Audit */}
                  <RunInsights summary={summary} anomalies={anoms} onSeek={setSeek} />
                </div>
              ) : (
                <div className="panel p-10 text-center text-muted text-[13px]">
                  Extracting sensor timeseries from telemetry archive…
                </div>
              )}
            </div>
          ) : (
            <div className="panel p-12 text-center text-muted text-[13px]">
              Select a sortie from the archive to inspect its telemetry, anomalies, and playback.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
