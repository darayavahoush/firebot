import React from "react";
import { PanelHeader } from "../TelemetryGauges.jsx";
import { COMMAND_HELP } from "../../lib/commandHelp.js";
import HeardFix from "./HeardFix.jsx";
import { playSound } from "../../lib/sound.js";

const QUICK_DIRECTIVES = [
  { label: "STATUS REPORT", cmd: "status", color: "text-telemetry border-telemetry/40 bg-telemetry/10" },
  { label: "SUPPRESS FIRE", cmd: "extinguish the fire", color: "text-alarm border-alarm/40 bg-alarm/10" },
  { label: "EMERGENCY HALT", cmd: "stop", color: "text-alarm border-alarm/50 bg-alarm/20" },
  { label: "RETURN TO DOCK", cmd: "return home", color: "text-muted border-line bg-panel2" },
  { label: "SCAN PERIMETER", cmd: "scan for fire", color: "text-warn border-warn/40 bg-warn/10" },
];

export default function VoiceTab({
  t, speechSupported, speechUsable, listening, toggleListening, transcript, voiceError, textCmd, setTextCmd,
  sendCommand, cmdInputRef, suggestions, showSuggestions, setShowSuggestions, fillCommand,
  asrStatus, asrError, toggleRecording, voiceMode, speakerInfo, operator, personalModel, onCalibrate,
  pendingClip, feedbackCommands, onFeedbackOpen, onFix, onSent, liveAccuracy,
}) {
  const live = speechUsable ? listening : asrStatus === "recording";
  const busy = asrStatus === "transcribing";
  const onMic = speechUsable ? toggleListening : toggleRecording;

  const last = t.commandLog[0];
  const err = speechUsable ? voiceError : asrStatus === "error" ? asrError : "";
  
  const submit = () => {
    if (!textCmd.trim()) return;
    playSound("click");
    sendCommand(textCmd.trim());
    onSent?.(textCmd.trim());
    setTextCmd("");
    setShowSuggestions(false);
  };

  const handleQuickDirective = (cmd) => {
    playSound("ack");
    sendCommand(cmd);
    onSent?.(cmd);
  };

  return (
    <div className="flex flex-col min-w-0">
      {/* Tactical Transceiver Header */}
      <div className="p-4 bg-panel2/80 border-b border-line flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 flex-wrap text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${live ? "bg-alarm animate-pulse" : "bg-telemetry"}`} />
            <span className="font-bold tracking-wider text-ink uppercase">
              TAC-VOX TRANSCEIVER // CH-01
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-faint">
            <span className="bg-panel px-1.5 py-0.5 rounded border border-line">BAND 142.85 MHz</span>
            <span className="bg-panel px-1.5 py-0.5 rounded border border-line">GATE: VAD AUTO-DISPATCH</span>
          </div>
        </div>

        {/* Tactical Push-To-Talk / VOX Bar */}
        <div className="flex flex-col gap-2">
          <button
            onClick={onMic}
            disabled={busy}
            aria-pressed={live}
            className={`w-full py-3.5 px-4 rounded-xl border font-mono font-bold text-xs uppercase tracking-wider transition-all duration-150 flex items-center justify-between gap-3 shadow-md cursor-pointer ${
              live
                ? "bg-alarm/15 text-alarm border-alarm/50 shadow-[0_0_16px_rgba(239,68,68,0.3)] animate-pulse"
                : busy
                ? "bg-panel2 text-muted border-line cursor-wait opacity-60"
                : "bg-panel hover:bg-panel2 text-ink border-line hover:border-telemetry/50"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span className={`h-3 w-3 rounded-full flex items-center justify-center ${live ? "bg-alarm" : "bg-telemetry"}`}>
                <span className="h-1.5 w-1.5 rounded-full bg-base" />
              </span>
              <span>
                {live
                  ? speechUsable
                    ? "LIVE VOX ACTIVE • AUTO-DISPATCH (<0.5s)"
                    : "RECORDING • AUTO-SENDS ON PAUSE"
                  : busy
                  ? "PROCESSING AUDIO PACKET…"
                  : speechUsable
                  ? "PRESS TO OPEN VOICE CHANNEL"
                  : "RECORD TACTICAL VOICE DIRECTIVE"}
              </span>
            </div>

            {/* Segmented LED VU Meter Simulation */}
            <div className="flex items-center gap-0.5" title="Audio level">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((bar) => {
                const lit = live && (transcript ? bar <= 7 : bar <= 3);
                const color = bar >= 7 ? "bg-alarm" : bar >= 5 ? "bg-warn" : "bg-ok";
                return (
                  <span
                    key={bar}
                    className={`h-3 w-1 rounded-xs transition-opacity ${
                      lit ? `${color} opacity-100` : "bg-line/40 opacity-30"
                    }`}
                  />
                );
              })}
            </div>
          </button>

          {/* Real-Time Live Transcript Readout with Instant Send */}
          {transcript && (
            <div className="bg-[#0A0D14] rounded-lg p-2.5 border border-telemetry/40 flex items-center justify-between gap-3 animate-fadeIn">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] font-mono text-telemetry font-bold shrink-0">RX AUDIO:</span>
                <span className="text-xs font-mono text-ink italic truncate">"{transcript}"</span>
              </div>
              <button
                onClick={() => {
                  sendCommand(transcript);
                  onSent?.(transcript);
                }}
                className="px-2 py-0.5 rounded bg-telemetry text-base font-mono font-bold text-[10px] uppercase shrink-0 hover:brightness-110 active:scale-95"
              >
                Send Now ↵
              </button>
            </div>
          )}

          {err && (
            <div className="text-[11px] font-mono text-warn bg-warn/10 p-2 rounded-lg border border-warn/30">
              {err}
            </div>
          )}

          {/* Operator Profile Pill */}
          <div className="flex items-center justify-between text-[11px] font-mono text-faint pt-1">
            <span className="flex items-center gap-1.5">
              <span>OPERATOR:</span>
              <b className="text-ink uppercase">{operator || "ananya"}</b>
            </span>
            <button
              onClick={onCalibrate}
              className="text-muted hover:text-telemetry transition-colors underline"
            >
              Voice Calibration Studio
            </button>
          </div>
        </div>
      </div>

      {/* Quick Tactical Command Chips */}
      <div className="p-3 bg-panel/50 border-b border-line space-y-2">
        <div className="text-[10px] font-mono uppercase text-muted tracking-wider">
          Quick Directives (1-Click Dispatch)
        </div>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_DIRECTIVES.map((d) => (
            <button
              key={d.label}
              onClick={() => handleQuickDirective(d.cmd)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold border transition-all hover:scale-102 active:scale-95 cursor-pointer ${d.color}`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* Typed Command Deck */}
      <div className="p-3 border-b border-line flex gap-2">
        <div className="flex-1 relative">
          <input
            ref={cmdInputRef}
            value={textCmd}
            aria-label="Type a command"
            onChange={(e) => { setTextCmd(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => window.setTimeout(() => setShowSuggestions(false), 120)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); else if (e.key === "Escape") setShowSuggestions(false); }}
            placeholder="Type directive (e.g. 'status', 'suppress fire', 'stop')..."
            autoComplete="off"
            className="w-full rounded-lg bg-panel2 border border-line px-3 py-2 text-[12px] font-mono text-ink outline-none focus:border-telemetry"
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-lg border border-line bg-panel shadow-lg overflow-hidden">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onMouseDown={(e) => { e.preventDefault(); fillCommand(s); }}
                  className="w-full text-left px-3 py-1.5 text-[12px] font-mono text-ink hover:bg-panel2 hover:text-telemetry"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={submit}
          className="px-4 py-2 rounded-lg bg-panel2 hover:bg-panel border border-line hover:border-telemetry text-xs font-mono font-bold text-ink transition-colors"
        >
          Execute
        </button>
      </div>

      <HeardFix pending={pendingClip} commands={feedbackCommands} onOpen={onFeedbackOpen} onPick={onFix} />

      {/* Last Command Status */}
      <div className="p-3 border-b border-line flex items-center justify-between text-xs font-mono">
        <span className="text-muted">LAST DIRECTIVE:</span>
        {last ? (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-ink truncate font-semibold">"{last.text}"</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
              last.intent === "UNKNOWN" ? "bg-warn/20 text-warn border border-warn/30" : "bg-ok/20 text-ok border border-ok/30"
            }`}>
              {last.intent}
            </span>
          </div>
        ) : (
          <span className="text-faint">NO DISPATCH YET</span>
        )}
      </div>

      {/* Eligible Speech Commands */}
      <PanelHeader label="Command Grammar Reference" right={<span className="text-[10px] font-mono text-faint">TAP TO LOAD</span>} />
      <div className="border-t border-line divide-y divide-line max-h-56 overflow-y-auto">
        {COMMAND_HELP.map((c, i) => (
          <details key={c.intent} open={i === 0} className="px-4 py-2 group">
            <summary className="cursor-pointer flex items-center justify-between text-xs font-mono">
              <span className="text-ink font-bold uppercase">{c.intent.replace("_", " ")}</span>
              <span className="text-[10px] text-faint">{c.examples.length} phrases</span>
            </summary>
            <p className="text-[11px] text-muted leading-relaxed mt-1 mb-2 font-sans">{c.fn}</p>
            <div className="flex flex-wrap gap-1">
              {c.examples.map((ex) => (
                <button
                  key={ex}
                  onClick={() => fillCommand(ex)}
                  className="px-2 py-0.5 rounded text-[10px] font-mono bg-panel2 border border-line text-muted hover:text-ink hover:border-telemetry transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>
          </details>
        ))}
      </div>

      {/* Chronological Transceiver History */}
      <PanelHeader label="Acoustic Transmission Log" right={<span className="text-[10px] font-mono text-faint">SORTIE STREAM</span>} />
      <div className="border-t border-line divide-y divide-line max-h-48 overflow-y-auto">
        {t.commandLog.length === 0 && (
          <div className="px-4 py-3 text-xs font-mono text-faint">No voice transmissions logged.</div>
        )}
        {t.commandLog.map((c, i) => (
          <button
            key={i}
            onClick={() => fillCommand(c.text)}
            className="w-full px-4 py-2 flex items-center justify-between gap-3 text-xs font-mono text-left hover:bg-panel2 transition-colors"
          >
            <span className="truncate text-ink">"{c.text}"</span>
            <span className={`text-[10px] shrink-0 font-bold uppercase ${c.intent === "UNKNOWN" ? "text-faint" : "text-telemetry"}`}>
              {c.intent}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
