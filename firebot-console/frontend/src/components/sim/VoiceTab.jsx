import React from "react";
import { PanelHeader } from "../TelemetryGauges.jsx";
import { COMMAND_HELP } from "../../lib/commandHelp.js";
import HeardFix from "./HeardFix.jsx";
import { playSound } from "../../lib/sound.js";

const QUICK_DIRECTIVES = [
  { label: "Status report", cmd: "status", color: "text-telemetry border-telemetry/30 bg-telemetry/10" },
  { label: "Suppress fire", cmd: "extinguish the fire", color: "text-flame border-flame/30 bg-flame/10" },
  { label: "Emergency halt", cmd: "stop", color: "text-alarm border-alarm/30 bg-alarm/10" },
  { label: "Return to dock", cmd: "return home", color: "text-muted border-line bg-panel2" },
  { label: "Scan perimeter", cmd: "scan for fire", color: "text-warn border-warn/30 bg-warn/10" },
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
      <div className="p-4 bg-panel2/60 border-b border-line flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 flex-wrap text-[12px]">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${live ? "bg-alarm pulse-dot" : "bg-telemetry"}`} />
            <span className="font-semibold text-ink">
              Voice transceiver (CH-01)
            </span>
          </div>
          <div className="flex items-center gap-1.5 data text-[10px] text-faint">
            <span className="bg-panel px-1.5 py-0.5 rounded border border-line">Band 142.85 MHz</span>
            <span className="bg-panel px-1.5 py-0.5 rounded border border-line">VAD auto-dispatch</span>
          </div>
        </div>

        {/* Tactical Push-To-Talk / VOX Bar */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onMic}
            disabled={busy}
            aria-pressed={live}
            className={`w-full py-2.5 px-3 rounded-lg border text-[12px] font-medium transition-colors flex items-center justify-between gap-2 cursor-pointer ${
              live
                ? "bg-telemetry text-onaccent border-telemetry"
                : busy
                ? "bg-panel2 text-muted border-line cursor-wait opacity-60"
                : "bg-panel hover:bg-panel2 text-ink border-line hover:border-line2"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full flex items-center justify-center ${live ? "bg-alarm" : "bg-telemetry"}`} />
              <span>
                {live
                  ? speechUsable
                    ? "Live channel active (listening…)"
                    : "Recording (auto-sends on pause)"
                  : busy
                  ? "Transcribing voice directive…"
                  : speechUsable
                  ? "Open voice channel"
                  : "Record voice directive"}
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
                    className={`h-2.5 w-1 rounded-xs transition-opacity ${
                      lit ? `${color} opacity-100` : "bg-line/40 opacity-30"
                    }`}
                  />
                );
              })}
            </div>
          </button>

          {/* Real-Time Live Transcript Readout with Instant Send */}
          {transcript && (
            <div className="bg-panel rounded-lg p-2.5 border border-telemetry/40 flex items-center justify-between gap-3 animate-fadeIn">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] text-telemetry font-semibold shrink-0">RX:</span>
                <span className="text-[12px] text-ink italic truncate">"{transcript}"</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  sendCommand(transcript);
                  onSent?.(transcript);
                }}
                className="px-2 py-0.5 rounded bg-telemetry text-onaccent text-[11px] font-semibold shrink-0 hover:brightness-105"
              >
                Send now ↵
              </button>
            </div>
          )}

          {err && (
            <div className="text-[11px] text-warn bg-warn/10 p-2 rounded-lg border border-warn/30">
              {err}
            </div>
          )}

          {/* Operator Profile Pill */}
          <div className="flex items-center justify-between text-[11.5px] text-muted pt-1">
            <span className="flex items-center gap-1.5">
              <span>Operator:</span>
              <b className="text-ink capitalize font-semibold">{operator || "ananya"}</b>
            </span>
            <button
              type="button"
              onClick={onCalibrate}
              className="text-muted hover:text-ink underline underline-offset-2 transition-colors"
            >
              Voice studio
            </button>
          </div>
        </div>
      </div>

      {/* Quick Directives */}
      <div className="p-3 bg-panel/40 border-b border-line space-y-2">
        <div className="panel-eyebrow text-[10px]">
          Quick directives (one-click dispatch)
        </div>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_DIRECTIVES.map((d) => (
            <button
              key={d.label}
              type="button"
              onClick={() => handleQuickDirective(d.cmd)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors cursor-pointer ${d.color}`}
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
            placeholder="Type directive ('status', 'suppress fire', 'stop')..."
            autoComplete="off"
            className="w-full rounded-lg bg-panel2 border border-line px-3 py-1.5 text-[12.5px] text-ink outline-none focus:border-telemetry"
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-lg border border-line bg-panel shadow-md overflow-hidden">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); fillCommand(s); }}
                  className="w-full text-left px-3 py-1.5 text-[12px] text-ink hover:bg-panel2"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={submit}
          className="btn !py-1.5 !px-3 text-[12px]"
        >
          Execute
        </button>
      </div>

      <HeardFix pending={pendingClip} commands={feedbackCommands} onOpen={onFeedbackOpen} onPick={onFix} />

      {/* Last Command Status */}
      <div className="p-3 border-b border-line flex items-center justify-between text-[12px]">
        <span className="text-muted">Last directive:</span>
        {last ? (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-ink truncate font-medium">"{last.text}"</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
              last.intent === "UNKNOWN" ? "bg-warn/20 text-warn border border-warn/30" : "bg-ok/20 text-ok border border-ok/30"
            }`}>
              {last.intent}
            </span>
          </div>
        ) : (
          <span className="text-faint">None dispatched yet</span>
        )}
      </div>

      {/* Command Grammar Reference */}
      <PanelHeader label="Command grammar reference" right={<span className="text-[10px] text-faint">Click to test</span>} />
      <div className="border-t border-line divide-y divide-line max-h-56 overflow-y-auto">
        {COMMAND_HELP.map((c, i) => (
          <details key={c.intent} open={i === 0} className="px-4 py-2 group">
            <summary className="cursor-pointer flex items-center justify-between text-[12px] font-medium text-ink">
              <span className="capitalize">{c.intent.toLowerCase().replace("_", " ")}</span>
              <span className="text-[10px] text-faint">{c.examples.length} phrases</span>
            </summary>
            <p className="text-[11.5px] text-muted leading-relaxed mt-1 mb-2">{c.fn}</p>
            <div className="flex flex-wrap gap-1">
              {c.examples.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => fillCommand(ex)}
                  className="px-2 py-0.5 rounded text-[10.5px] bg-panel2 border border-line text-muted hover:text-ink hover:border-line2 transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>
          </details>
        ))}
      </div>

      {/* Chronological Transceiver History */}
      <PanelHeader label="Acoustic transmission log" />
      <div className="border-t border-line divide-y divide-line max-h-48 overflow-y-auto">
        {t.commandLog.length === 0 && (
          <div className="px-4 py-3 text-[12px] text-faint">No voice transmissions logged.</div>
        )}
        {t.commandLog.map((c, i) => (
          <button
            key={i}
            type="button"
            onClick={() => fillCommand(c.text)}
            className="w-full px-4 py-2 flex items-center justify-between gap-3 text-[12px] text-left hover:bg-panel2 transition-colors"
          >
            <span className="truncate text-ink">"{c.text}"</span>
            <span className={`text-[10px] shrink-0 font-medium ${c.intent === "UNKNOWN" ? "text-faint" : "text-telemetry"}`}>
              {c.intent}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
