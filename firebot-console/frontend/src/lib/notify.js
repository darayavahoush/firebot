// Browser notifications for the console. They fire only while the console tab is open but
// hidden (the on-screen UI already covers a visible tab). No server or service worker involved.
const KEY = "nirvana.notify";

export const notifySupported = () => typeof window !== "undefined" && "Notification" in window;

export function notifyEnabled() {
  try { return notifySupported() && Notification.permission === "granted" && localStorage.getItem(KEY) === "on"; }
  catch { return false; }
}

export async function setNotifyEnabled(on) {
  if (!notifySupported()) return false;
  if (on && Notification.permission !== "granted") {
    if ((await Notification.requestPermission()) !== "granted") return false;
  }
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* storage blocked: stays on for this session only */ }
  return on;
}

export function notify(title, body, tag) {
  if (!notifyEnabled() || !document.hidden) return;
  const n = new Notification(title, { body, tag, renotify: true });
  n.onclick = () => { window.focus(); n.close(); };
}
