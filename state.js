// Wspólny stan + cache w localStorage (klucze nawyki.*; token jest osobno w api.js).
export const ls = (k, d = null) => {
  try { const v = localStorage.getItem("nawyki." + k); return v == null ? d : JSON.parse(v); } catch { return d; }
};
export const lsSet = (k, v) => { try { localStorage.setItem("nawyki." + k, JSON.stringify(v)); } catch { /* pełny storage */ } };

export const S = {
  config: ls("config"), cfgSha: ls("cfgsha"),
  date: null, draft: null, sha: null, saved: null,
  dirty: false, queued: false, saving: false, loading: false, err: "",
  days: new Set(ls("daylist", [])), daysKnown: false,
  edit: null, editDirty: false,
  hooks: {}
};

export const queue = () => ls("queue", []);
export const setQueue = q => lsSet("queue", q);

export function cacheDay(date, entry) {
  const all = ls("days", {});
  if (entry) all[date] = entry; else delete all[date];
  const keys = Object.keys(all).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 120))) delete all[k];
  lsSet("days", all);
}
export const cachedDay = date => ls("days", {})[date] || null;

// pole -> wartość domyślna formularza
export function defaultOf(f) {
  if (f.default !== undefined) return f.default;
  return f.type === "bool" ? false : f.type === "text" ? "" : f.type === "scale" ? (f.min ?? 0) : 0;
}
export const isPos = v => v === true || (typeof v === "number" && v > 0) || (typeof v === "string" && v.trim() !== "");
