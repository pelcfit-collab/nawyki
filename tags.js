// Czysty moduł (bez DOM): normalizacja, slugi, scalanie opcji i operacje na listach wyboru (tagach).
// Opcja: { id, label, mergedInto?, active? }.

// trim, pojedyncze spacje, bez wielkości liter i znaków diakrytycznych
export const normalize = s => String(s ?? "").toLowerCase().replace(/ł/g, "l").normalize("NFD")
  .replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

export const slugBase = s => normalize(s).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "opcja";

// slug unikalny w obrębie listy opcji (kolizja -> _2, _3…)
export function uniqueSlug(label, options, preferred) {
  const taken = new Set((options || []).map(o => o.id));
  const base = preferred || slugBase(label);
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}_${n++}`;
  return id;
}

// "  ból   ucha " -> "Ból ucha"
export function capFirst(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t ? t[0].toLocaleUpperCase("pl") + t.slice(1) : "";
}

// Łańcuch mergedInto rozwiązywany do końca (z ochroną przed cyklem i brakującym celem).
export function resolveMerged(options, id) {
  const by = new Map((options || []).map(o => [o.id, o]));
  const seen = new Set();
  let cur = id;
  while (!seen.has(cur)) {
    seen.add(cur);
    const o = by.get(cur);
    if (!o || !o.mergedInto || !by.has(o.mergedInto)) return cur;
    cur = o.mergedInto;
  }
  return cur;
}

// Wpisany tekst -> istniejąca opcja (po rozwiązaniu scaleń; może być nieaktywna) albo null.
export function findMatch(options, text) {
  const n = normalize(text);
  if (!n) return null;
  const list = options || [];
  const hit = list.find(o => normalize(o.label) === n) || list.find(o => o.id === slugBase(text));
  if (!hit) return null;
  const by = new Map(list.map(o => [o.id, o]));
  return by.get(resolveMerged(list, hit.id)) || hit;
}

// Podpowiedzi: opcje (także scalone/nieaktywne -> ich cel) zawierające fragment wpisanego tekstu.
export function suggest(options, q, excludeIds = []) {
  const nq = normalize(q);
  if (!nq) return [];
  const list = options || [], by = new Map(list.map(o => [o.id, o])), ex = new Set(excludeIds), out = [], seen = new Set();
  for (const o of list) {
    if (!normalize(o.label).includes(nq)) continue;
    const t = by.get(resolveMerged(list, o.id)) || o;
    if (seen.has(t.id) || ex.has(t.id)) continue;
    seen.add(t.id); out.push(t);
  }
  return out;
}

export const isVisible = o => o.active !== false && !o.mergedInto;

// Liczność użycia opcji (po rozwiązaniu scaleń) w dniach od `since` (YYYY-MM-DD).
// days: [{date, values, details}], where: "main" | "detail".
export function countUsage(days, fid, where, options, since = "") {
  const counts = {};
  for (const d of days || []) {
    if (!d || (since && d.date < since)) continue;
    const raw = (where === "main" ? d.values : d.details)?.[fid];
    // tagi: tablica id; liczniki (v3): obiekt { id: liczba } -> użyte rodzaje (> 0)
    const arr = Array.isArray(raw) ? raw : isCounts(raw) ? Object.keys(raw).filter(k => Number(raw[k]) > 0) : null;
    if (!arr) continue;
    for (const id of new Set(arr.map(x => resolveMerged(options, x)))) counts[id] = (counts[id] || 0) + 1;
  }
  return counts;
}

/* ---------- liczniki per opcja (v3, `counts`) ---------- */

export const isCounts = v => !!v && typeof v === "object" && !Array.isArray(v);

// Suma wartości > 0.
export const sumCounts = obj => Object.values(obj || {}).reduce((a, n) => a + (Number(n) > 0 ? Number(n) : 0), 0);

// { id: n } -> tylko n > 0, id po rozwiązaniu scaleń, scalone opcje sumują się.
export function resolveCounts(options, obj) {
  const out = {};
  for (const [id, n] of Object.entries(obj || {})) {
    const v = Number(n);
    if (!(v > 0)) continue;
    const t = resolveMerged(options, id);
    out[t] = (out[t] || 0) + v;
  }
  return out;
}

// Najczęściej używane najpierw, potem alfabetycznie (pl).
export function rankOptions(options, counts = {}) {
  return [...options].sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0) || a.label.localeCompare(b.label, "pl"));
}

// Wybrane id po rozwiązaniu scaleń, bez duplikatów.
export const resolveSelection = (options, ids) => [...new Set((ids || []).map(x => resolveMerged(options, x)))];

/* ---------- operacje na konfiguracji (nowe opcje z ekranu Dziś) ---------- */
// op: { fid, where: "main"|"detail", kind: "add"|"react", id, label }

export const optContainer = (f, where) => (where === "main" ? f : f?.detail);

// Stosuje operacje do (kopii) konfiguracji. Zwraca { cfg, remap } gdzie remap["fid|where|stareId"] = nowyId.
// Odporne na zmiany zdalne: dopasowanie po znormalizowanej etykiecie, kolizja id -> _2.
export function applyOps(config, ops) {
  const cfg = JSON.parse(JSON.stringify(config)), remap = {};
  for (const op of ops || []) {
    const f = (cfg.fields || []).find(x => x.id === op.fid);
    const c = f && optContainer(f, op.where);
    if (!c) continue;
    const opts = (c.options ||= []);
    const react = o => { if (o.active === false) delete o.active; };
    if (op.kind === "react") {
      const o = opts.find(x => x.id === resolveMerged(opts, op.id));
      if (o) react(o);
      continue;
    }
    const m = findMatch(opts, op.label);
    let id;
    if (m) { react(m); id = m.id; }
    else { id = uniqueSlug(op.label, opts, op.id && !opts.some(o => o.id === op.id) ? op.id : undefined); opts.push({ id, label: op.label }); }
    if (id !== op.id) remap[`${op.fid}|${op.where}|${op.id}`] = id;
  }
  return { cfg, remap };
}

// Podmienia id w danych dnia wg remap (i usuwa duplikaty).
export function applyRemap(data, remap) {
  if (!remap || !Object.keys(remap).length) return data;
  const out = JSON.parse(JSON.stringify(data));
  const fix = (obj, where) => {
    for (const [fid, arr] of Object.entries(obj || {})) {
      if (Array.isArray(arr)) obj[fid] = [...new Set(arr.map(x => remap[`${fid}|${where}|${x}`] ?? x))];
      else if (isCounts(arr)) {
        const o = {};
        for (const [k, n] of Object.entries(arr)) { const t = remap[`${fid}|${where}|${k}`] ?? k; o[t] = (o[t] || 0) + Number(n); }
        obj[fid] = o;
      }
    }
  };
  fix(out.values, "main"); fix(out.details, "detail");
  for (const [fid, kinds] of Object.entries(out.times || {})) {
    const o = {};
    for (const [k, arr] of Object.entries(kinds || {})) { const t = remap[`${fid}|detail|${k}`] ?? k; o[t] = [...(o[t] || []), ...(Array.isArray(arr) ? arr : [])]; }
    for (const t of Object.keys(o)) o[t] = sortTimes(o[t]);
    out.times[fid] = o;
  }
  return out;
}

export function opsMessage(ops) {
  const added = (ops || []).filter(o => o.kind === "add").map(o => o.label);
  if (added.length) return `config: nowe opcje (${added.join(", ")})`;
  return "config: przywrócone opcje";
}

// Pole count z detalem `counts` (v3): values[id] = suma z details[id] = { opcja: liczba }.
export const hasCounts = f => f?.type === "count" && f.detail?.type === "counts";

// Suma dnia: z podziału, a gdy go nie ma - stara suma bez podziału.
export const dayTotal = (split, noSplit) => { const s = sumCounts(split); return s > 0 ? s : Number(noSplit) || 0; };

/* ---------- godzina każdej porcji (v4, `withTime`) ---------- */
// Dzień: times[fid][opcja] = [godzina 0-23 | null, ...], długość = licznik opcji.

export const withTime = f => hasCounts(f) && f.detail.withTime === true;

const okHour = x => Number.isInteger(x) && x >= 0 && x <= 23;

// Rosnąco po godzinie, nieznane (null) na końcu.
export const sortTimes = arr => (arr || []).map(x => (okHour(x) ? x : null)).sort((a, b) => (a === null) - (b === null) || a - b);

// Dopasowuje długość do licznika: brakujące -> null, nadmiar odcięty, sort.
export function fitTimes(arr, n) {
  const a = sortTimes(Array.isArray(arr) ? arr : []);
  while (a.length < n) a.push(null);
  return sortTimes(a.slice(0, Math.max(0, n)));
}

// Godzina nowej porcji: dziś -> bieżąca godzina warszawska, dzień przeszły -> null.
export const newPortionHour = (date, today, nowHour) => (date === today && okHour(nowHour) ? nowHour : null);

export const addPortion = (arr, hour) => sortTimes([...(arr || []), okHour(hour) ? hour : null]);
export const removePortion = arr => (arr || []).slice(0, -1);
export function setHour(arr, i, hour) {
  const a = [...(arr || [])]; a[i] = okHour(hour) ? hour : null;
  return sortTimes(a);
}

// Scala godziny po rozwiązaniu scaleń (konkatenacja + sort); długość = rozwiązany licznik. Tylko opcje z licznikiem > 0.
export function resolveTimes(options, counts, times) {
  const merged = {};
  for (const [id, arr] of Object.entries(times || {})) {
    const t = resolveMerged(options, id);
    merged[t] = [...(merged[t] || []), ...(Array.isArray(arr) ? arr : [])];
  }
  const out = {};
  for (const [id, n] of Object.entries(counts || {})) if (Number(n) > 0) out[id] = fitTimes(merged[id], Number(n));
  return out;
}

// Lista godzin do wyboru: 5..23, potem 0..4.
export const HOURS = [...Array.from({ length: 19 }, (_, i) => i + 5), 0, 1, 2, 3, 4];
export const fmtHour = x => (okHour(x) ? `${x}:00` : "?");
