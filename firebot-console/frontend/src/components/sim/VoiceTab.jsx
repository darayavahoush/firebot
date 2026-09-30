import React from "react";
import { PanelHeader } from "../TelemetryGauges.jsx";
import { COMMAND_HELP } from "../../lib/commandHelp.js";

const MODE_LABEL = { local: "local model", "local-degraded": "local model failing, using fallback", vosk: "Vosk, offline", "vosk-degraded": "Vosk failing, using Groq", groq: "Groq", unavailable: "unavailable" };

export default function VoiceTab({
  t, speechSupported, speechUsable, listening, toggleListening, transcript, voiceError, textCmd, setTextCmd,
  sendCommand, cmdInputRef, suggestions, showSuggestions, setShowSuggestions, fillCommand,
  asrStatus, asrError, toggleRecording, voiceMode, speakerInfo, operator, personalModel, onCalibrate,
}) {
  const live = speechUsable ? listening : asrStatus === "recording";
  const busy = asrStatus === "transcribing";
  const onMic = speechUsable ? toggleListening : toggleRecording;
  const state = live ? (speechUsable ? "Listening. Just talk." : "Recording. Tap again to send.") : busy ? "Transcribing…" : speechUsable ? "Tap to start listening" : "Tap to record a command";
  const last = t.commandLog[0];
  const err = speechUsable ? voiceError : asrStatus === "error" ? asrError : "";
  const submit = () => { sendCommand(textCmd); setTextCmd(""); setShowSuggestions(false); };
  return (
    <div>
      <div className="px-4 py-5 flex flex-col items-center gap-2.5">
        <button onClick={onMic} disabled={busy} aria-pressed={live} aria-label={live ? "Stop microphone" : "Start microphone"}
          className={`w-[72px] h-[72px] rounded-full border-2 grid place-items-center transition-all ${live ? "border-alarm text-alarm pulse-dot shadow-[0_0_24px_rgba(255,74,43,0.4)]" : "border-telemetry text-telemetry hover:bg-telemetry hover:text-base"} ${busy ? "opacity-40 cursor-wait" : ""}`}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
        </button>
        <div className="text-[13px] text-ink">{state}</div>
        {transcript && <div className="text-[13px] text-muted italic">“{transcript}…”</div>}
        {err && <div className="text-[12px] text-warn text-center max-w-[260px]">{err}</div>}
        {!speechUsable && <div className="text-[11px] text-faint text-center max-w-[240px]">{speechSupported ? "This browser has no working live speech engine (Opera and Brave)." : "This browser has no live speech recognition."} Recordings are transcribed on the server.</div>}
        <div className="flex flex-wrap justify-center gap-1.5">
          {voiceMode && <span className={`chip cursor-default ${voiceMode.mode === "unavailable" ? "!text-alarm" : ""}`}>Speech: {MODE_LABEL[voiceMode.mode] || voiceMode.mode}</span>}
          {personalModel && <span className="chip cursor-default !text-ok">Voice model: {personalModel}'s</span>}
          <button className="chip" onClick={onCalibrate}>{operator ? "Recalibrate my voice" : "Calibrate my voice"}</button>
          {speakerInfo && <span className={`chip cursor-default ${speakerInfo.name ? "!text-ok" : "!text-warn"}`}>Speaker: {speakerInfo.name ?? "not recognised"}</span>}
        </div>
        {voiceMode?.last_error && <div className="text-[11px] text-warn text-center">{voiceMode.last_error}</div>}
      </div>

      <div className="border-t border-line px-4 py-3 flex gap-2">
        <div className="flex-1 relative">
          <input ref={cmdInputRef} value={textCmd} aria-label="Type a command"
            onChange={(e) => { setTextCmd(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)} onBlur={() => window.setTimeout(() => setShowSuggestions(false), 120)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); else if (e.key === "Escape") setShowSuggestions(false); }}
            placeholder="or type: go to the north room" autoComplete="off"
            className="w-full rounded-lg bg-panel2 border border-line px-3 py-2 text-[13px] text-ink outline-none focus:border-telemetry" />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-lg border border-line bg-panel shadow-lg overflow-hidden">
              {suggestions.map((s) => (
                <button key={s} onMouseDown={(e) => { e.preventDefault(); fillCommand(s); }} className="w-full text-left px-3 py-1.5 text-[13px] text-ink hover:bg-panel2 hover:text-telemetry">{s}</button>
              ))}
            </div>
          )}
        </div>
        <button onClick={submit} className="btn">Send</button>
      </div>

      <div className="border-t border-line px-4 py-3">
        <div className="text-[11px] text-muted mb-1.5">Last command</div>
        {last ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[14px] truncate">“{last.text}”</span>
            <span className={`chip cursor-default shrink-0 ${last.intent === "UNKNOWN" ? "!text-warn" : "!text-ok"}`}>{last.intent === "UNKNOWN" ? "not understood" : last.intent}</span>
          </div>
        ) : <div className="text-[13px] text-faint">Nothing yet. Try “status”.</div>}
      </div>

      <PanelHeader label="Things you can say" right={<span className="text-[11px] text-faint">tap to try</span>} />
      <div className="border-t border-line divide-y divide-line">
        {COMMAND_HELP.map((c, i) => (
          <details key={c.intent} open={i === 0} className="px-4 py-2.5 group">
            <summary className="cursor-pointer flex items-center justify-between text-[13px]">
              <span className="text-ink">{c.intent.replace("_", " ").toLowerCase()}</span>
              <span className="text-[11px] text-faint">{c.examples.length} phrases</span>
            </summary>
            <p className="text-[12px] text-muted leading-relaxed mt-1.5 mb-2">{c.fn}</p>
            <div className="flex flex-wrap gap-1.5">
              {c.examples.map((ex) => <button key={ex} onClick={() => fillCommand(ex)} className="chip hover:!text-telemetry hover:!border-telemetry">{ex}</button>)}
            </div>
          </details>
        ))}
      </div>

      <PanelHeader label="History" right={<span className="text-[11px] text-faint">tap to reuse</span>} />
      <div className="border-t border-line divide-y divide-line max-h-64 overflow-y-auto">
        {t.commandLog.length === 0 && <div className="px-4 py-3 text-[13px] text-faint">Commands you send will appear here.</div>}
        {t.commandLog.map((c, i) => (
          <button key={i} onClick={() => fillCommand(c.text)} className="w-full px-4 py-2 flex items-center justify-between gap-3 text-[13px] text-left hover:bg-panel2 transition-colors">
            <span className="truncate">{c.text}</span>
            <span className={`text-[11px] shrink-0 ${c.intent === "UNKNOWN" ? "text-faint" : "text-telemetry"}`}>{c.intent}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
