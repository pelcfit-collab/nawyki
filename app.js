import { S, lsSet, queue, setQueue, cacheDay, cachedDay, defaultOf, isPos } from "./state.js";
import { h, $, toast } from "./ui.js";
import * as api from "./api.js";
import * as D from "./dates.js";
import { renderSettings, initSettings } from "./settings.js";
import * as T from "./tags.js";
import { tagsWidget, countsWidget } from "./tagsui.js";

const dayPath = d => `days/${d}.json`;
const activeFields = () => (S.config?.fields || []).filter(f => f.active !== false);

/* ---------- konfiguracja i dane dnia ---------- */

async function loadConfig() {
  if (!api.getToken()) return;
  try {
    const f = await api.getFile("config.json");
    if (f) { S.config = f.data; S.cfgSha = f.sha; lsSet("config", f.data); lsSet("cfgsha", f.sha); }
  } catch (e) { if (!api.isOffline(e)) S.err = "Config: " + api.describe(e); }
}

async function loadDayList() {
  if (!api.getToken()) return;
  try {
    S.days = new Set(await api.listDays());
    S.daysKnown = true;
    lsSet("daylist", [...S.days]);
  } catch (e) { /* offline: zostaje cache */ }
}

// Pola z listą wyboru: główne (type "tags") i szczegóły (detail.type "tags").
function tagTargets() {
  const out = [];
  for (const f of activeFields()) {
    if (f.type === "tags") out.push({ f, where: "main", opts: f.options || [] });
    if (f.detail?.type === "tags") out.push({ f, where: "detail", opts: f.detail.options || [] });
  }
  return out;
}

function setDraft(data, ops) {
  const values = { ...(data?.values || {}) };
  for (const f of activeFields()) if (values[f.id] === undefined) values[f.id] = defaultOf(f);
  const details = { ...(data?.details || {}) }, legacy = {};
  for (const { f, where, opts } of tagTargets()) {
    const box = where === "main" ? values : details;
    if (where === "detail" && typeof box[f.id] === "string") {
      if (box[f.id].trim()) legacy[f.id] = box[f.id]; // stary tekstowy wpis: tylko do odczytu
      delete box[f.id];
    } else if (Array.isArray(box[f.id])) box[f.id] = T.resolveSelection(opts, box[f.id]);
    else if (where === "main") box[f.id] = [];
  }
  // v3: liczniki per rodzaj. Stare dni: tablica tagów -> rodzaje z licznikiem 0; sama suma -> "bez podziału".
  const legacyKinds = {}, noSplit = {}, times = {};
  for (const f of activeFields()) {
    if (!T.hasCounts(f)) continue;
    const opts = f.detail.options || [], raw = details[f.id], total = Number(values[f.id]) || 0;
    if (Array.isArray(raw)) { legacyKinds[f.id] = T.resolveSelection(opts, raw); noSplit[f.id] = total; details[f.id] = {}; }
    else if (T.isCounts(raw)) {
      details[f.id] = T.resolveCounts(opts, raw);
      noSplit[f.id] = T.sumCounts(details[f.id]) > 0 ? 0 : total;
    } else { details[f.id] = {}; noSplit[f.id] = total > 0 ? total : 0; }
    values[f.id] = T.dayTotal(details[f.id], noSplit[f.id]);
    if (T.withTime(f)) times[f.id] = T.resolveTimes(opts, details[f.id], data?.times?.[f.id]); // v4: stare dni bez times -> "?"
  }
  S.draft = { values, details, legacy, legacyKinds, noSplit, times, rawTimes: data?.times || {}, pending: (ops || []).map(o => ({ ...o })), note: data?.note || "" };
  S.saved = data?.updatedAt || null;
}

function buildData() {
  const fields = S.config.fields, byId = Object.fromEntries(fields.map(f => [f.id, f]));
  const values = { ...S.draft.values }, details = {};
  for (const f of fields) if (T.hasCounts(f) && f.active !== false) values[f.id] = T.dayTotal(S.draft.details[f.id], S.draft.noSplit?.[f.id]);
  const times = {};
  for (const [fid, t] of Object.entries(S.draft.rawTimes || {})) if (!T.withTime(byId[fid]) || byId[fid].active === false) times[fid] = t; // nie gubimy cudzych godzin
  for (const f of fields) {
    if (!T.withTime(f) || f.active === false) continue;
    const t = T.resolveTimes(f.detail.options || [], T.resolveCounts(f.detail.options || [], S.draft.details[f.id]), S.draft.times?.[f.id]);
    if (Object.keys(t).length) times[f.id] = t;
  }
  let note = S.draft.note.trim();
  for (const [id, v] of Object.entries(S.draft.details)) {
    const f = byId[id];
    if (T.isCounts(v)) {
      const c = T.resolveCounts(f?.detail?.options || [], v);
      if (T.sumCounts(c) > 0 && (!f || f.active === false || isPos(values[id]))) details[id] = c;
      continue;
    }
    if (v === "" || v == null || (Array.isArray(v) && !v.length) || (f && f.active !== false && !isPos(values[id]))) continue;
    details[id] = v;
  }
  for (const [id, kinds] of Object.entries(S.draft.legacyKinds || {})) {
    if (!details[id] && isPos(values[id])) details[id] = kinds; // brak podziału: wcześniejsze rodzaje zostają bez zmian
  }
  for (const [id, old] of Object.entries(S.draft.legacy || {})) {
    const f = byId[id];
    if (!f || f.active === false || !isPos(values[id])) continue;
    if (!details[id]) details[id] = old; // brak wybranych tagów: stary tekst zostaje bez zmian
    else if (!note.includes(old)) note += (note ? "\n" : "") + `${f.label} (stary wpis): ${old}`; // nic nie ginie
  }
  const out = { date: S.date, values, details, note, updatedAt: D.nowIso(), app: "nawyki/1" };
  if (Object.keys(times).length) out.times = times;
  return out;
}

// Nowe/reaktywowane opcje, które zostały wybrane (odznaczone nie trafiają do config).
function buildOps() {
  return S.draft.pending.filter(p => {
    const a = (p.where === "main" ? S.draft.values : S.draft.details)[p.fid];
    return Array.isArray(a) ? a.includes(p.id) : T.isCounts(a) && Number(a[p.id]) > 0;
  });
}

async function openDay(date) {
  S.date = date; S.err = ""; S.dirty = false;
  const q = queue().find(x => x.date === date), c = cachedDay(date);
  S.queued = !!q; S.sha = c?.sha || null;
  setDraft(q?.data || c?.data || null, q?.ops);
  S.loading = !q && !!api.getToken();
  renderToday();
  if (!S.loading) return;
  try {
    const f = await api.getFile(dayPath(date));
    if (S.date !== date || S.dirty) return;
    if (f) { S.sha = f.sha; cacheDay(date, f); S.days.add(date); setDraft(f.data); }
    else { S.sha = null; cacheDay(date, null); S.days.delete(date); setDraft(null); }
  } catch (e) { if (!api.isOffline(e)) S.err = api.describe(e); }
  if (S.date === date) { S.loading = false; renderToday(); }
}

export async function goDate(date, { force = false } = {}) {
  if (!force && S.dirty && !confirm("Masz niezapisane zmiany tego dnia. Odrzucić je?")) return;
  const today = D.todayStr();
  if (!D.isDate(date) || date > today) date = today;
  showTab("today");
  await openDay(date);
}

/* ---------- zapis i kolejka offline ---------- */

// Zapis nowych opcji do config.json (przed dniem). Przy konflikcie sha scala po id/etykiecie na świeżej wersji.
async function persistOps(ops) {
  let res;
  const r = await api.saveJson("config.json", T.opsMessage(ops), remote => {
    res = T.applyOps(remote === undefined ? S.config : (remote?.data ?? S.config), ops);
    return res.cfg;
  }, S.cfgSha);
  S.config = res.cfg; S.cfgSha = r.sha; lsSet("config", S.config); lsSet("cfgsha", r.sha);
  return res.remap;
}

async function save() {
  if (S.saving) return;
  if (!api.getToken()) { showTab("settings"); toast("Najpierw dodaj token"); return; }
  let data = buildData(), ops = buildOps();
  const date = S.date;
  S.saving = true; S.err = ""; renderStatus();
  const enqueue = () => {
    setQueue([...queue().filter(x => x.date !== date), { date, data, ops }]);
    S.dirty = false; S.queued = true; S.saved = null;
  };
  try {
    if (ops.length) {
      try { data = T.applyRemap(data, await persistOps(ops)); ops = []; }
      catch (e) { if (!api.isOffline(e)) throw e; enqueue(); S.saving = false; renderStatus(); return; }
    }
    const r = await api.saveJson(dayPath(date), `dzień ${date}`, () => data, S.sha);
    S.sha = r.sha; S.days.add(date); lsSet("daylist", [...S.days]);
    cacheDay(date, { data, sha: r.sha });
    setQueue(queue().filter(x => x.date !== date));
    S.dirty = false; S.queued = false; S.saved = data.updatedAt;
    if (S.date === date) { setDraft(data); S.saved = data.updatedAt; renderToday(); }
  } catch (e) {
    if (api.isOffline(e)) enqueue(); // config już poszedł (ops puste) albo nie było nowych opcji
    else S.err = api.describe(e);
  }
  S.saving = false;
  renderStatus();
}

let flushing = false;
async function flushQueue() {
  if (flushing || !api.getToken() || !queue().length || !navigator.onLine) return;
  flushing = true;
  for (const item of queue()) {
    try {
      let { data, ops = [] } = item;
      if (ops.length) {
        data = T.applyRemap(data, await persistOps(ops));
        setQueue(queue().map(x => (x.date === item.date ? { date: item.date, data, ops: [] } : x)));
      }
      const cur = await api.getFile(dayPath(item.date));
      const r = await api.saveJson(dayPath(item.date), `dzień ${item.date}`, () => data, cur?.sha);
      setQueue(queue().filter(x => x.date !== item.date));
      cacheDay(item.date, { data, sha: r.sha });
      S.days.add(item.date);
      if (item.date === S.date && !S.dirty) { S.queued = false; S.sha = r.sha; setDraft(data); S.saved = data.updatedAt; renderToday(); }
      toast(`Wysłano z kolejki: ${item.date}`);
    } catch (e) {
      if (!api.isOffline(e)) toast("Kolejka: " + api.describe(e));
      break;
    }
  }
  flushing = false;
  if (S.date) renderStatus();
}

/* ---------- ekran Dziś ---------- */

function renderStatus() {
  const chip = $("#chip"), st = $("#status"), btn = $("#saveBtn");
  let text, cls = "";
  if (S.saving) text = "Zapisuję…";
  else if (S.err) { text = "Błąd: " + S.err; cls = "bad"; }
  else if (S.dirty) { text = "Niezapisane zmiany"; cls = "warn"; }
  else if (S.queued) { text = "W kolejce (offline)"; cls = "warn"; }
  else if (S.saved) { text = `Zapisano ${D.hm(S.saved)}`; cls = "ok"; }
  else text = "Niezapisany dzień";
  st.textContent = text; st.className = "status " + cls;
  const chipText = S.loading ? "wczytuję…" : S.queued ? "w kolejce" : S.dirty ? "zmienione, niezapisane"
    : S.saved ? `zapisany o ${D.hm(S.saved)}` : "niezapisany dzień";
  chip.textContent = chipText; chip.className = "chip " + (S.saved && !S.dirty ? "ok" : "warn");
  btn.disabled = S.saving || !S.config;
}

function touch() { S.dirty = true; S.err = ""; S.queued = false; renderStatus(); }

function renderToday() {
  const today = D.todayStr();
  $("#dateLabel").textContent = D.fmtLong(S.date) + (S.date === today ? " (dziś)" : "");
  $("#next").disabled = S.date >= today;
  const form = $("#form");
  if (!S.config) {
    form.replaceChildren(h("div", { class: "empty" },
      h("p", {}, "Brak konfiguracji pól. Dodaj token w ustawieniach, aby pobrać ją z repozytorium."),
      h("button", { class: "btn", onclick: () => showTab("settings") }, "Otwórz ustawienia")));
    renderStatus(); return;
  }
  const groups = new Map();
  for (const f of activeFields()) {
    const g = f.group || "Inne";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(f);
  }
  const out = [];
  for (const [g, fields] of groups) {
    out.push(h("section", { class: "group" }, h("h2", {}, g), h("div", { class: "grid" }, fields.map(fieldEl))));
  }
  out.push(h("section", { class: "group" }, h("h2", {}, "Notatka"),
    h("textarea", { rows: 3, placeholder: "Dowolna notatka dnia…", value: S.draft.note,
      oninput: e => { S.draft.note = e.target.value; touch(); } })));
  form.replaceChildren(...out);
  renderStatus();
}

function setVal(f, v) { S.draft.values[f.id] = v; touch(); renderToday(); }

function fieldEl(f) {
  const v = S.draft.values[f.id];
  let main;
  if (f.type === "bool") {
    main = h("button", { class: "tile" + (v ? " on" : ""), "aria-pressed": String(!!v), onclick: () => setVal(f, !v) },
      h("span", { class: "tick" }, v ? "✓" : ""), h("span", {}, f.label));
  } else if (f.type === "count") {
    const n = Number(v) || 0;
    main = h("div", { class: "row wide" }, h("span", { class: "lbl" }, f.label),
      h("div", { class: "stepper" },
        h("button", { "aria-label": "Mniej", disabled: n <= 0, onclick: () => setVal(f, Math.max(0, n - 1)) }, "−"),
        h("output", {}, String(n), f.unit ? h("small", {}, " " + f.unit) : null),
        h("button", { "aria-label": "Więcej", onclick: () => setVal(f, n + 1) }, "+")));
  } else if (f.type === "scale") {
    const min = f.min ?? 0, max = f.max ?? 3, segs = [];
    for (let i = min; i <= max; i++) {
      segs.push(h("button", { class: "seg" + (v === i ? " on" : ""), "aria-pressed": String(v === i), onclick: () => setVal(f, i) },
        f.scaleLabels?.[i - min] ?? String(i)));
    }
    main = h("div", { class: "wide" }, h("div", { class: "lbl" }, f.label), h("div", { class: "segs" }, segs));
  } else if (f.type === "tags") {
    main = h("div", { class: "wide" }, h("div", { class: "lbl" }, f.label), tagsWidget(f, "main", touch));
  } else {
    main = h("label", { class: "wide" }, h("span", { class: "lbl" }, f.label),
      h("input", { type: "text", value: v ?? "", oninput: e => { S.draft.values[f.id] = e.target.value; touch(); } }));
  }
  if (T.hasCounts(f)) return countsWidget(f, touch);
  if (!f.detail || !isPos(v)) return main;
  const d = f.detail, num = d.type === "number";
  if (d.type === "tags") {
    const old = S.draft.legacy?.[f.id];
    return h("div", { class: "wide" }, main, h("div", { class: "detail" }, h("span", {}, d.label),
      old ? h("p", { class: "legacy" }, "stary wpis: " + old) : null, tagsWidget(f, "detail", touch)));
  }
  const input = h("input", { type: num ? "number" : "text", inputmode: num ? "decimal" : null, min: num ? "0" : null,
    value: S.draft.details[f.id] ?? "", placeholder: d.unit || "",
    oninput: e => {
      const t = e.target.value;
      S.draft.details[f.id] = num ? (t === "" || isNaN(Number(t)) ? "" : Number(t)) : t;
      touch();
    } });
  return h("div", { class: "wide" }, main, h("label", { class: "detail" }, h("span", {}, d.label + (d.unit ? ` (${d.unit})` : "")), input));
}

/* ---------- ekran Historia ---------- */

const hist = { y: 0, m: 0 };
const markers = date => {
  const v = (cachedDay(date)?.data || (queue().find(x => x.date === date)?.data))?.values;
  return v ? { ill: v.choroba > 0, alc: v.alkohol > 0 } : null;
};

async function renderHistory() {
  if (!hist.y) { const [y, m] = D.todayStr().split("-").map(Number); hist.y = y; hist.m = m; }
  if (!S.daysKnown) await loadDayList();
  drawHistory();
  fillMarkers();
}

function drawHistory() {
  const today = D.todayStr(), { y, m } = hist, first = D.ymd(y, m, 1), pad = D.weekdayMon0(first);
  const cells = [...Array(pad).fill(null)];
  for (let d = 1; d <= D.daysInMonth(y, m); d++) cells.push(D.ymd(y, m, d));
  const grid = ["pn", "wt", "śr", "cz", "pt", "so", "nd"].map(n => h("div", { class: "dow" }, n));
  for (const date of cells) {
    if (!date) { grid.push(h("div")); continue; }
    const saved = S.days.has(date) || queue().some(x => x.date === date), future = date > today;
    const mk = saved ? markers(date) : null;
    grid.push(h("button", { class: "cal" + (date === today ? " today" : "") + (saved ? " saved" : future ? " future" : " empty"),
      disabled: future, "aria-label": D.fmtLong(date) + (saved ? ", zapisany" : ""), onclick: () => goDate(date) },
      h("span", { class: "num" }, String(+date.slice(8))),
      h("span", { class: "dot" }), mk?.ill ? h("i", { class: "mk ill" }) : null, mk?.alc ? h("i", { class: "mk alc" }) : null));
  }
  let empties = "–";
  if (S.daysKnown) {
    let n = 0;
    for (let i = 1; i <= 14; i++) if (!S.days.has(D.addDays(today, -i))) n++;
    empties = String(n);
  }
  $("#tab-history").replaceChildren(
    h("div", { class: "monthbar" },
      h("button", { class: "icon", "aria-label": "Poprzedni miesiąc", onclick: () => shiftMonth(-1) }, "‹"),
      h("strong", {}, D.fmtMonth(y, m)),
      h("button", { class: "icon", "aria-label": "Następny miesiąc", onclick: () => shiftMonth(1) }, "›")),
    h("div", { class: "calgrid" }, grid),
    h("p", { class: "legend" }, h("span", { class: "k saved" }), "zapisany ", h("span", { class: "k empty" }), "pusty ",
      h("i", { class: "mk ill" }), "choroba ", h("i", { class: "mk alc" }), "alkohol"),
    h("div", { class: "stat" }, h("strong", {}, empties), " pustych dni w ostatnich 14 (bez dzisiaj)"));
}

function shiftMonth(n) {
  hist.m += n;
  if (hist.m < 1) { hist.m = 12; hist.y--; } else if (hist.m > 12) { hist.m = 1; hist.y++; }
  drawHistory(); fillMarkers();
}

// Dociąga dni bieżącego miesiąca, których nie ma w cache (tylko dla znaczników choroba/alkohol).
async function fillMarkers() {
  if (!api.getToken()) return;
  const { y, m } = hist;
  const todo = [...S.days].filter(d => d.startsWith(`${y}-${String(m).padStart(2, "0")}`) && !cachedDay(d));
  let changed = false;
  const worker = async () => {
    for (let d; (d = todo.pop());) {
      try { const f = await api.getFile(dayPath(d)); if (f) { cacheDay(d, f); changed = true; } } catch { return; }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (changed && hist.y === y && hist.m === m && S.tab === "history") drawHistory();
}

/* ---------- nawigacja i start ---------- */

function showTab(tab) {
  S.tab = tab;
  for (const t of ["today", "history", "settings"]) {
    $("#tab-" + t).hidden = t !== tab;
    document.querySelector(`nav [data-tab="${t}"]`).classList.toggle("on", t === tab);
  }
  $("#header").hidden = tab !== "today";
  if (tab === "history") renderHistory();
  if (tab === "settings") renderSettings();
  window.scrollTo(0, 0);
}

function rerenderToday() {
  if (S.draft) for (const f of activeFields()) if (S.draft.values[f.id] === undefined) S.draft.values[f.id] = defaultOf(f);
  renderToday();
}

async function init() {
  S.hooks = { loadConfig, loadDayList, afterToken, rerenderToday };
  initSettings();
  document.querySelectorAll("nav [data-tab]").forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));
  $("#prev").onclick = () => goDate(D.addDays(S.date, -1));
  $("#next").onclick = () => goDate(D.addDays(S.date, 1));
  $("#saveBtn").onclick = save;
  window.addEventListener("online", flushQueue);
  window.addEventListener("beforeunload", e => { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("message", e => { if (e.data?.type === "open-date") goDate(e.data.date); });
  }

  const wanted = new URLSearchParams(location.search).get("date");
  await goDate(wanted || D.todayStr(), { force: true });
  if (!api.getToken()) showTab("settings");
  await afterToken();
}

// po starcie lub zmianie tokenu: świeża konfiguracja, lista dni, kolejka
async function afterToken() {
  if (!api.getToken()) return;
  await loadConfig();
  if (S.date && !S.dirty) await openDay(S.date); else renderToday();
  await flushQueue();
  loadDayList();
}

init();
