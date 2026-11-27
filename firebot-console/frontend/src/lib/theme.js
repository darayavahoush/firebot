// Light / dark theme. "system" = no data-theme attribute, so the OS preference decides (see index.css).
const KEY = "firebot-theme";

export function getTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function effectiveTheme() {
  const t = getTheme();
  if (t !== "system") return t;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function setTheme(t) {
  const root = document.documentElement;
  try {
    if (t === "light" || t === "dark") {
      localStorage.setItem(KEY, t);
      root.setAttribute("data-theme", t);
    } else {
      localStorage.removeItem(KEY);
      root.removeAttribute("data-theme");
    }
  } catch {
    /* storage blocked — theme still applies for this session */
    if (t === "light" || t === "dark") root.setAttribute("data-theme", t);
  }
}

export function toggleTheme() {
  const next = effectiveTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}
