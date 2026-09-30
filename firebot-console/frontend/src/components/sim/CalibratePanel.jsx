import React, { useCallback, useEffect, useRef, useState } from "react";
import { blobToWav16k } from "../../lib/wav";
import { cleanOperator, OPERATOR_RE, setOperator } from "../../lib/operator.js";

const CLIP_MS = 2600;
const API = "/api/voice/calibrate";

async function api(path, opts) {
  const res = await fetch(`${API}${path}`, opts);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail || `Request failed (${res.status})`);
  return body;
}

async function recordClip() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  try {
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    const stopped = new Promise((r) => { rec.onstop = r; });
    rec.start();
    setTimeout(() => { if (rec.state !== "inactive") rec.stop(); }, CLIP_MS);
    await stopped;
    return new Blob(chunks, { type: rec.mimeType || "audio/webm" });
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

/** Guided per-user voice calibration: say each command a few times, then train a personal model. */
export default function CalibratePanel({ operator, onOperator, onClose, onTrained }) {
  const [name, setName] = useState(operator || "");
  const [active, setActive] = useState(operator || "");
  const [st, setSt] = useState(null);
  const [phase, setPhase] = useState("idle"); // idle | recording | saving | training
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async (user) => {
    try { setSt(await api(`/status?user=${encodeURIComponent(user)}`)); setError(""); }
    catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { if (active) load(active); }, [active, load]);
  // while a background retrain runs, refresh so the result shows up by itself
  useEffect(() => {
    if (!active || !st?.learning?.retraining) return undefined;
    const id = setInterval(() => load(active), 3000);
    return () => clearInterval(id);
  }, [active, st?.learning?.retraining, load]);

  const start = () => {
    const n = cleanOperator(name);
    if (!OPERATOR_RE.test(n)) { setError("Use 1-32 letters, digits, '-' or '_'."); return; }
    setOperator(n); onOperator(n); setActive(n); setError("");
  };

  const required = (st?.classes || []).filter((c) => !c.optional);
  const target = st?.target_per_class ?? 5;
  const current = required.find((c) => c.count < target);
  const ready = required.length > 0 && required.every((c) => c.count >= 3);
  const doneCount = required.reduce((a, c) => a + Math.min(c.count, target), 0);
  const total = required.length * target;

  const record = async () => {
    if (!current || phase !== "idle") return;
    setError("");
    try {
      setPhase("recording");
      const blob = await recordClip();
      setPhase("saving");
      let upload = blob, fname = "clip.webm";
      try { upload = await blobToWav16k(blob); fname = "clip.wav"; } catch { /* server tries the raw clip */ }
      const form = new FormData();
      form.append("file", upload, fname);
      const next = await api(`/clip?user=${encodeURIComponent(active)}&label=${current.label}`, { method: "POST", body: form });
      if (alive.current) setSt(next);
    } catch (e) {
      if (alive.current) setError(e.name === "NotAllowedError" ? "Microphone access was denied. Allow it in your browser's site settings." : e.message);
    } finally {
      if (alive.current) setPhase("idle");
    }
  };

  const redo = async () => {
    const prev = [...required].reverse().find((c) => c.count > 0 && (c === current || c.count >= target || c.count > 0));
    const label = (current && current.count > 0 ? current : prev)?.label;
    if (!label) return;
    try { setSt(await api(`/clip?user=${encodeURIComponent(active)}&label=${label}`, { method: "DELETE" })); }
    catch (e) { setError(e.message); }
  };

  const train = async () => {
    setPhase("training"); setError("");
    try {
      const next = await api(`/train?user=${encodeURIComponent(active)}`, { method: "POST" });
      if (alive.current) { setSt(next); onTrained?.(next); }
    } catch (e) { if (alive.current) setError(e.message); }
    finally { if (alive.current) setPhase("idle"); }
  };

  const reset = async () => {
    try { setSt(await api(`/model?user=${encodeURIComponent(active)}&clips=true`, { method: "DELETE" })); onTrained?.(null); }
    catch (e) { setError(e.message); }
  };

  const rep = st?.report;
  const busy = phase !== "idle";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Calibrate voice">
      <div className="w-full max-w-md rounded-xl border border-line bg-panel p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[15px] text-ink font-semibold">Calibrate my voice</div>
            <div className="text-[12px] text-muted mt-0.5">Say each command a few times. Takes about 3 minutes and gives you a model tuned to your voice and mic.</div>
          </div>
          <button className="text-muted hover:text-ink text-lg leading-none" onClick={onClose} aria-label="Close">×</button>
        </div>

        {!active && (
          <div className="space-y-2">
            <label className="text-[12px] text-muted" htmlFor="op-name">Your name</label>
            <input id="op-name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && start()}
              placeholder="e.g. ananya" className="w-full rounded-md border border-line bg-panel2 px-3 py-2 text-[13px] text-ink outline-none focus:border-telemetry" />
            <button className="btn" onClick={start}>Continue</button>
          </div>
        )}

        {active && st && !st.supported && <div className="text-[12px] text-warn">{st.reason}</div>}

        {active && st?.supported && (
          <>
            <div className="text-[12px] text-muted">Operator: <span className="text-ink">{active}</span>{st.has_model && <span className="text-ok"> · personal model active</span>}</div>
            <div className="h-1.5 rounded-full bg-panel2 overflow-hidden"><div className="h-full bg-telemetry transition-all" style={{ width: `${total ? (100 * doneCount) / total : 0}%` }} /></div>

            {current ? (
              <div className="text-center space-y-3 py-2">
                <div className="text-[12px] text-muted">Say this ({current.count + 1} of {target})</div>
                <div className="text-[22px] text-ink font-semibold">“{current.phrase}”</div>
                <button className={`btn ${phase === "recording" ? "!border-alarm !text-alarm" : ""}`} onClick={record} disabled={busy}>
                  {phase === "recording" ? "Recording… say it now" : phase === "saving" ? "Saving…" : "Record"}
                </button>
                <div><button className="text-[11px] text-faint hover:text-muted" onClick={redo} disabled={busy}>Undo last clip</button></div>
              </div>
            ) : (
              <div className="text-[12px] text-ok text-center py-2">All commands recorded.</div>
            )}

            <div className="flex flex-wrap gap-1.5">
              {required.map((c) => (
                <span key={c.label} className={`chip cursor-default ${c.count >= target ? "!text-ok" : c.count > 0 ? "!text-warn" : ""}`}>{c.phrase} · {Math.min(c.count, target)}/{target}</span>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button className="btn" onClick={train} disabled={!ready || busy}>{phase === "training" ? "Training…" : st.has_model ? "Retrain" : "Train my model"}</button>
              {st.has_model && <button className="btn !text-alarm" onClick={reset} disabled={busy}>Reset to default</button>}
              {!ready && <span className="text-[11px] text-faint">Needs at least 3 clips of each command.</span>}
            </div>

            {st.has_model && (
              <div className="text-[12px] space-y-1 rounded-md border border-line px-3 py-2">
                <div className="text-ink">Keeps improving as you use it</div>
                <div className="text-muted">
                  {st.live?.accuracy != null
                    ? `Right ${Math.round(st.live.accuracy * 100)}% of the time over your last ${st.live.decisions} voice commands.`
                    : "No feedback yet. Send a voice command as-is to confirm it, or use “Not right? Fix it” when it's wrong."}
                </div>
                <div className="text-faint">
                  {st.learning?.retraining ? "Retraining now…"
                    : `${st.learning?.new ?? 0} new correction${(st.learning?.new ?? 0) === 1 ? "" : "s"}/confirmation${(st.learning?.new ?? 0) === 1 ? "" : "s"} so far. It retrains itself after ${st.learning?.auto_min_new} (or ${st.learning?.auto_min_corrections} corrections), and only keeps the result if it beats your current model on clips it never trained on.`}
                </div>
                {st.history?.length > 0 && (() => {
                  const h = st.history[st.history.length - 1];
                  const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
                  return <div className="text-faint">Last {h.trigger === "auto" ? "automatic " : ""}retrain: {h.accepted ? `kept (${pct(h.incumbent_acc ?? h.base_acc)} → ${pct(h.personal_acc)} on held-out clips)` : `not used. ${h.reason || ""}`}</div>;
                })()}
              </div>
            )}

            {rep && (
              <div className={`text-[12px] rounded-md border px-3 py-2 ${rep.accepted ? "border-ok/50 text-ok" : "border-warn/50 text-warn"}`}>
                {rep.accepted
                  ? `Done. On clips it hadn't trained on: yours ${Math.round(rep.personal_acc * 100)}% vs default ${Math.round(rep.base_acc * 100)}%. Your model is now active.`
                  : rep.reason || "Not saved."}
              </div>
            )}
          </>
        )}

        {error && <div className="text-[12px] text-alarm">{error}</div>}
        <div className="text-[10px] text-faint">Recordings are stored on the console server (data/calibration/) and used only to build your model.</div>
      </div>
    </div>
  );
}
