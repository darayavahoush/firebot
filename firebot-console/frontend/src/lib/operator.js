// Which operator's personal voice model to use. Kept in localStorage (per browser); the backend
// also falls back to whoever the speaker-ID voiceprints recognise if this is empty.
const KEY = "firebot.operator";
export const OPERATOR_RE = /^[a-z0-9_-]{1,32}$/;

export function getOperator() {
  try { return localStorage.getItem(KEY) || ""; } catch { return ""; }
}
export function setOperator(name) {
  try { name ? localStorage.setItem(KEY, name) : localStorage.removeItem(KEY); } catch { /* private mode */ }
}
export function cleanOperator(raw) {
  return (raw || "").trim().toLowerCase().replace(/\s+/g, "-");
}
