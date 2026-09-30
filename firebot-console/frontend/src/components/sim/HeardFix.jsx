import React, { useState } from "react";

/** Shown under the text box after a voice clip is read for a known operator. If the transcript is wrong,
 *  picking the right command teaches that person's model. (Sending it unchanged confirms it.) */
export default function HeardFix({ pending, commands, onPick, onOpen }) {
  const [open, setOpen] = useState(false);
  if (!pending) return null;
  return (
    <div className="border-t border-line px-4 py-2 flex flex-wrap items-center gap-2 text-[12px]">
      <span className="text-muted">Heard “{pending.text}”.</span>
      {!open ? (
        <button className="text-telemetry hover:underline" onClick={() => { setOpen(true); onOpen?.(); }}>Not right? Fix it</button>
      ) : (
        <select autoFocus defaultValue="" aria-label="What did you actually say?"
          className="rounded-md border border-line bg-panel2 px-2 py-1 text-[12px] text-ink"
          onChange={(e) => { if (e.target.value) { onPick(e.target.value); setOpen(false); } }}>
          <option value="" disabled>What did you say?</option>
          {commands.map((c) => <option key={c.label} value={c.label}>{c.label === "UNKNOWN" ? "Not a command" : c.phrase}</option>)}
        </select>
      )}
      <span className="text-faint">Sending it as-is confirms it.</span>
    </div>
  );
}
