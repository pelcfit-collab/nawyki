import { APP } from "./config.js";
import { S, lsSet, defaultOf } from "./state.js";
import { h, $, toast } from "./ui.js";
import * as api from "./api.js";
import * as D from "./dates.js";
import * as T from "./tags.js";

const SUBS = "push/subscriptions.json";
const clone = o => JSON.parse(JSON.stringify(o));
const msgs = {}; // komunikaty sekcji: token, push, cfg

export function initSettings() {}

export function renderSettings() {
  if (!S.editDirty) S.edit = S.config ? clone(S.config) : null;
  $("#tab-settings").replaceChildren(tokenSection(), pushSection(), remindersSection(), fieldsSection());
  refreshPushStatus();
}

const say = (key, text, cls = "") => {
  msgs[key] = { text, cls };
  const el = document.getElementById("msg-" + key);
  if (el) { el.textContent = text; el.className = "msg " + cls; }
};
const msgEl = key => h("p", { id: "msg-" + key, class: "msg " + (msgs[key]?.cls || ""), role: "status" }, msgs[key]?.text || "");

/* ---------- token ---------- */

function tokenSection() {
  const has = !!api.getToken();
  const input = h("input", { type: "password", autocomplete: "off", autocapitalize: "off", spellcheck: "false",
    placeholder: has ? "Nowy token (zastąpi zapisany)" : "Wklej token GitHub" });
  return h("section", { class: "card" },
    h("h2", {}, "Token GitHub"),
    h("p", { class: "hint" }, has ? "Token zapisany w tej przeglądarce (nie jest wyświetlany)." : "Brak tokenu. Bez niego aplikacja nie zapisze danych."),
    input,
    h("div", { class: "btns" },
      h("button", { class: "btn", onclick: async () => {
        const t = input.value.trim();
        if (!t) return say("token", "Wklej token.", "bad");
        api.setToken(t); input.value = "";
        say("token", "Token zapisany. Sprawdzam…");
        await S.hooks.afterToken();
        await check();
        renderSettings();
      } }, "Zapisz token"),
      h("button", { class: "btn ghost", onclick: check }, "Sprawdź połączenie"),
      has ? h("button", { class: "btn ghost danger", onclick: () => {
        if (!confirm("Usunąć token z tej przeglądarki?")) return;
        api.setToken(""); say("token", "Token usunięty."); renderSettings();
      } }, "Usuń token") : null),
    msgEl("token"),
    h("details", {},
      h("summary", {}, "Jak utworzyć token"),
      h("ol", { class: "steps" },
        h("li", {}, "GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token."),
        h("li", {}, "Expiration: do 1 roku (po wygaśnięciu trzeba wygenerować nowy)."),
        h("li", {}, `Repository access: Only select repositories → ${APP.dataRepo}.`),
        h("li", {}, "Permissions → Repository permissions → Contents: Read and write."),
        h("li", {}, "Generate token, skopiuj go i wklej powyżej. Token trafia tylko do api.github.com."))));
}

async function check() {
  if (!api.getToken()) return say("token", "Brak tokenu.", "bad");
  say("token", "Sprawdzam…");
  try {
    const r = await api.checkRepo();
    const canWrite = r.permissions?.push;
    say("token", `Połączono z ${r.full_name}${canWrite === false ? " (tylko odczyt, zapis nie zadziała!)" : ""}.`, canWrite === false ? "bad" : "ok");
  } catch (e) { say("token", "Błąd: " + api.describe(e), "bad"); }
}

/* ---------- powiadomienia ---------- */

const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function urlB64ToUint8(b64url) {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const bin = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function pushSection() {
  return h("section", { class: "card" },
    h("h2", {}, "Powiadomienia"),
    h("p", { id: "pushStatus", class: "hint" }, "…"),
    h("div", { class: "btns" },
      h("button", { class: "btn", onclick: enablePush }, "Włącz powiadomienia"),
      h("button", { class: "btn ghost", onclick: testPush }, "Pokaż testowe")),
    msgEl("push"));
}

async function refreshPushStatus() {
  const el = $("#pushStatus");
  if (!el) return;
  if (!pushSupported()) { el.textContent = "Ta przeglądarka nie obsługuje powiadomień push."; return; }
  let sub = null;
  try { sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription(); } catch { /* brak SW */ }
  const perm = { granted: "zezwolono", denied: "zablokowano w ustawieniach przeglądarki", default: "jeszcze nie zapytano" }[Notification.permission];
  el.textContent = `Uprawnienie: ${perm}. Subskrypcja: ${sub ? "aktywna na tym urządzeniu" : "brak"}.`;
}

async function enablePush() {
  if (!pushSupported()) return say("push", "Brak obsługi push w tej przeglądarce.", "bad");
  if (!api.getToken()) return say("push", "Najpierw dodaj token.", "bad");
  try {
    if ((await Notification.requestPermission()) !== "granted") return say("push", "Brak zgody na powiadomienia.", "bad");
    const reg = await navigator.serviceWorker.ready;
    const opts = { userVisibleOnly: true, applicationServerKey: urlB64ToUint8(APP.vapidPublicKey) };
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe(opts);
    const j = sub.toJSON();
    const entry = { endpoint: j.endpoint, keys: j.keys, addedAt: D.nowIso(), ua: navigator.userAgent.slice(0, 80) };
    const merge = remote => [...(remote === undefined ? existing : remote?.data || []).filter(s => s.endpoint !== entry.endpoint), entry];
    const cur = await api.getFile(SUBS);
    const existing = cur?.data || [];
    await api.saveJson(SUBS, "push: dodaj subskrypcję", merge, cur?.sha);
    say("push", "Powiadomienia włączone.", "ok");
  } catch (e) { say("push", "Błąd: " + api.describe(e), "bad"); }
  refreshPushStatus();
}

async function testPush() {
  if (!pushSupported()) return say("push", "Brak obsługi powiadomień.", "bad");
  try {
    if (Notification.permission !== "granted" && (await Notification.requestPermission()) !== "granted") return say("push", "Brak zgody na powiadomienia.", "bad");
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification("Nawyki", { body: "Testowe powiadomienie", icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "nawyki-test", data: { url: "./" } });
    say("push", "Wysłano testowe powiadomienie.", "ok");
  } catch (e) { say("push", "Błąd: " + e.message, "bad"); }
}

/* ---------- zapis konfiguracji ---------- */

async function saveConfig(message, key) {
  if (!S.edit) return;
  if (!api.getToken()) return say(key, "Najpierw dodaj token.", "bad");
  say(key, "Zapisuję…");
  S.edit.reminders.sort((a, b) => a.hour - b.hour);
  try {
    const r = await api.saveJson("config.json", message, () => S.edit, S.cfgSha);
    S.config = clone(S.edit); S.cfgSha = r.sha; S.editDirty = false;
    lsSet("config", S.config); lsSet("cfgsha", r.sha);
    S.hooks.rerenderToday();
    renderSettings();
    say(key, "Zapisano w repozytorium.", "ok");
  } catch (e) { say(key, "Błąd: " + api.describe(e), "bad"); }
}
const dirty = () => { S.editDirty = true; };

/* ---------- przypomnienia ---------- */

function remindersSection() {
  const sec = h("section", { class: "card" }, h("h2", {}, "Przypomnienia"));
  if (!S.edit) return (sec.append(h("p", { class: "hint" }, "Dostępne po wczytaniu konfiguracji (dodaj token).")), sec);
  const rem = S.edit.reminders ||= [];
  const redraw = () => { dirty(); renderSettings(); };
  rem.forEach((r, i) => sec.append(h("div", { class: "rrow" },
    h("input", { type: "number", min: "0", max: "23", value: r.hour, "aria-label": "Godzina",
      oninput: e => { r.hour = Math.min(23, Math.max(0, parseInt(e.target.value, 10) || 0)); dirty(); } }),
    h("span", {}, ":00"),
    h("select", { "aria-label": "Dotyczy", onchange: e => { r.target = e.target.value; dirty(); } },
      h("option", { value: "today", selected: r.target === "today" }, "dzisiaj"),
      h("option", { value: "yesterday", selected: r.target === "yesterday" }, "wczoraj")),
    h("button", { class: "icon", "aria-label": "Usuń przypomnienie", onclick: () => { rem.splice(i, 1); redraw(); } }, "✕"))));
  if (!rem.length) sec.append(h("p", { class: "hint" }, "Brak przypomnień."));
  sec.append(
    h("p", { class: "hint" }, "Przypomnienie przychodzi, gdy wskazany dzień nie ma jeszcze zapisu. Sprawdzanie co godzinę (czas warszawski)."),
    h("div", { class: "btns" },
      h("button", { class: "btn ghost", onclick: () => { rem.push({ hour: 20, target: "today" }); redraw(); } }, "Dodaj godzinę"),
      h("button", { class: "btn", onclick: () => saveConfig("config: przypomnienia", "rem") }, "Zapisz")),
    msgEl("rem"));
  return sec;
}

/* ---------- pola ---------- */

const slug = s => {
  const base = s.toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "pole";
  let id = base, n = 2;
  while (S.edit.fields.some(f => f.id === id)) id = `${base}_${n++}`;
  return id;
};

function fieldsSection() {
  const sec = h("section", { class: "card" }, h("h2", {}, "Pola"));
  if (!S.edit) return (sec.append(h("p", { class: "hint" }, "Dostępne po wczytaniu konfiguracji (dodaj token).")), sec);
  const fields = S.edit.fields ||= [];
  const redraw = () => { dirty(); renderSettings(); };
  const move = (i, d) => { [fields[i], fields[i + d]] = [fields[i + d], fields[i]]; redraw(); };
  const groups = h("datalist", { id: "groupList" }, [...new Set(fields.map(f => f.group).filter(Boolean))].map(g => h("option", { value: g })));
  sec.append(groups);
  fields.forEach((f, i) => sec.append(fieldCard(f, i, fields.length, move, redraw)));
  sec.append(h("div", { class: "btns" }, h("button", { class: "btn", onclick: () => saveConfig("config: pola", "fld") }, "Zapisz pola")), msgEl("fld"), addFieldForm(redraw));
  return sec;
}

const labeled = (text, el) => h("label", { class: "f" }, h("span", {}, text), el);

// Parsuje "a, b, c" na unikalne opcje (dedupe wg normalizacji).
function parseOptions(text) {
  const opts = [];
  for (const part of String(text || "").split(",")) {
    const label = T.capFirst(part);
    if (label && !T.findMatch(opts, label)) opts.push({ id: T.uniqueSlug(label, opts), label });
  }
  return opts;
}

// Edytor opcji listy: zmiana nazwy, scalanie, ukrywanie, dodawanie. c = pole (type tags) albo f.detail (type tags).
function optionsEditor(c) {
  const opts = (c.options ||= []);
  const merging = new Set();
  const rows = h("div");
  const labelOf = id => opts.find(o => o.id === id)?.label || id;
  const change = () => { dirty(); drawRows(); };

  function rowEl(o) {
    const target = o.mergedInto ? T.resolveMerged(opts, o.id) : null;
    const name = h("div", { class: "name" }, h("b", {}, o.label),
      target ? h("small", {}, "scalona z: " + labelOf(target)) : null,
      o.active === false && !target ? h("small", {}, "ukryta") : null);
    const btns = h("div", { class: "btns" },
      h("button", { class: "btn ghost", onclick: () => {
        const v = prompt("Nowa nazwa opcji:", o.label);
        const label = T.capFirst(v);
        if (!label || label === o.label) return;
        const clash = opts.find(x => x.id !== o.id && T.normalize(x.label) === T.normalize(label));
        if (clash) return toast(`„${clash.label}” już istnieje. Użyj „Scal z…”.`);
        o.label = label; change();
      } }, "Zmień nazwę"),
      target
        ? h("button", { class: "btn ghost", onclick: () => { delete o.mergedInto; change(); } }, "Cofnij scalenie")
        : [h("button", { class: "btn ghost", onclick: () => { merging.add(o.id); drawRows(); } }, "Scal z…"),
           h("button", { class: "btn ghost", onclick: () => { if (o.active === false) delete o.active; else o.active = false; change(); } },
             o.active === false ? "Pokaż" : "Ukryj")]);
    const kids = [name, btns];
    if (merging.has(o.id)) {
      const cands = opts.filter(x => x.id !== o.id && !x.mergedInto && T.resolveMerged(opts, x.id) !== o.id);
      const sel = h("select", { "aria-label": "Scal z" }, cands.map(x => h("option", { value: x.id }, x.label)));
      kids.push(h("div", { class: "mrow" }, sel,
        h("button", { class: "btn", disabled: !cands.length, onclick: () => {
          const t = opts.find(x => x.id === sel.value);
          if (!t || !confirm(`Scalić „${o.label}” z „${t.label}”? Wcześniejsze wpisy „${o.label}” będą liczone jako „${t.label}”.`)) return;
          o.mergedInto = t.id; merging.delete(o.id); change();
        } }, "Scal"),
        h("button", { class: "btn ghost", onclick: () => { merging.delete(o.id); drawRows(); } }, "Anuluj")));
    }
    return h("div", { class: "opt" + (o.active === false || o.mergedInto ? " off" : "") }, kids);
  }
  const drawRows = () => rows.replaceChildren(...opts.map(rowEl), ...(opts.length ? [] : [h("p", { class: "hint" }, "Brak opcji.")]));

  const input = h("input", { type: "text", placeholder: c.type === "counts" ? "Nowy rodzaj, np. Whisky" : "Nowa opcja, np. Ból ucha", "aria-label": "Nowa opcja" });
  const add = () => {
    const label = T.capFirst(input.value);
    if (!label) return;
    const m = T.findMatch(opts, label);
    if (m) {
      if (m.active === false) { delete m.active; toast(`Przywrócono „${m.label}”`); change(); }
      else toast(`„${m.label}” już jest na liście`);
    } else { opts.push({ id: T.uniqueSlug(label, opts), label }); change(); }
    input.value = "";
  };
  input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  drawRows();
  return h("div", { class: "opts" }, h("h3", {}, "Opcje listy"), rows,
    h("div", { class: "optadd" }, input, h("button", { class: "btn", onclick: add }, "Dodaj")),
    h("p", { class: "hint" }, "Zmiany zapisują się dopiero przyciskiem „Zapisz pola”. Scalona opcja znika z wyboru, a stare wpisy liczą się jako docelowa."));
}

function fieldCard(f, i, n, move, redraw) {
  const inp = (type, key, extra = {}) => h("input", { type, value: f[key] ?? "", ...extra, oninput: e => { f[key] = e.target.value; dirty(); } });
  let def;
  if (f.type === "bool") def = h("input", { type: "checkbox", checked: !!f.default, onchange: e => { f.default = e.target.checked; dirty(); } });
  else if (f.type === "tags") def = null;
  else if (f.type === "text") def = inp("text", "default");
  else def = h("input", { type: "number", value: f.default ?? defaultOf(f), min: f.min ?? 0, max: f.max, oninput: e => { f.default = parseInt(e.target.value, 10) || 0; dirty(); } });
  const det = f.detail;
  const detBox = det ? h("div", { class: "sub" },
    labeled("Typ szczegółu", h("select", { onchange: e => { det.type = e.target.value; if (det.type === "tags" || det.type === "counts") det.options ||= []; redraw(); } },
      h("option", { value: "tags", selected: det.type === "tags" }, "lista (tagi)"),
      f.type === "count" ? h("option", { value: "counts", selected: det.type === "counts" }, "liczniki per rodzaj (counts)") : null,
      h("option", { value: "number", selected: det.type === "number" }, "liczba"),
      h("option", { value: "text", selected: det.type === "text" }, "tekst (tylko notatka, nie do statystyk)"))),
    labeled("Etykieta szczegółu", h("input", { type: "text", value: det.label || "", oninput: e => { det.label = e.target.value; dirty(); } })),
    det.type === "number" ? labeled("Jednostka szczegółu", h("input", { type: "text", value: det.unit || "", oninput: e => { det.unit = e.target.value; dirty(); } })) : null,
    det.type === "tags" || (det.type === "counts" && f.type === "count") ? optionsEditor(det) : null,
    det.type === "counts" ? h("p", { class: "hint" }, f.type === "count" ? "Na ekranie Dziś każdy rodzaj ma własny licznik, a wartość pola to ich suma." : "Liczniki per rodzaj działają tylko dla pola typu licznik.") : null,
    det.type === "text" ? h("p", { class: "hint" }, "Wolny tekst nie trafia do statystyk. Do powtarzalnych danych wybierz listę (tagi).") : null) : null;
  return h("details", { class: "fcard" + (f.active === false ? " off" : "") },
    h("summary", {}, h("span", {}, f.label || f.id), h("small", {}, ` ${f.group || ""}${f.active === false ? " · nieaktywne" : ""}`),
      h("span", { class: "mv" },
        h("button", { class: "icon", "aria-label": "W górę", disabled: i === 0, onclick: e => { e.preventDefault(); move(i, -1); } }, "↑"),
        h("button", { class: "icon", "aria-label": "W dół", disabled: i === n - 1, onclick: e => { e.preventDefault(); move(i, 1); } }, "↓"))),
    h("div", { class: "fbody" },
      labeled("Etykieta", inp("text", "label")),
      labeled("Grupa", inp("text", "group", { list: "groupList" })),
      def ? labeled("Wartość domyślna", def) : null,
      f.type === "tags" ? optionsEditor(f) : null,
      f.type === "text" ? h("p", { class: "hint" }, "Pole tekstowe służy tylko do notatki, nie do statystyk.") : null,
      f.type === "count" ? labeled("Jednostka", inp("text", "unit")) : null,
      f.type === "scale" ? h("p", { class: "hint" }, `Skala ${f.min}–${f.max}: ${(f.scaleLabels || []).join(" / ")}`) : null,
      det ? detBox : h("button", { class: "btn ghost", onclick: () => { f.detail = { type: "tags", label: "Szczegóły", showWhen: "positive", options: [] }; redraw(); } }, "Dodaj pole szczegółu"),
      det ? h("button", { class: "btn ghost", onclick: () => { delete f.detail; redraw(); } }, "Usuń pole szczegółu") : null,
      h("label", { class: "f chk" }, h("input", { type: "checkbox", checked: f.active !== false, onchange: e => { f.active = e.target.checked; redraw(); } }), h("span", {}, "Aktywne")),
      h("p", { class: "hint" }, `id: ${f.id} (niezmienne). Nieaktywne pole znika z formularza, historia zostaje.`)));
}

function addFieldForm(redraw) {
  const q = (tag, attrs, ...k) => h(tag, attrs, ...k);
  const label = q("input", { type: "text", placeholder: "np. Kawa" });
  const type = q("select", {}, ...[["bool", "tak/nie"], ["count", "licznik"], ["scale", "skala"], ["tags", "lista (tagi)"], ["text", "tekst (tylko notatka, nie do statystyk)"]].map(([v, t]) => q("option", { value: v }, t)));
  const group = q("input", { type: "text", list: "groupList", placeholder: "np. Jedzenie" });
  const unit = q("input", { type: "text", placeholder: "np. porcje (licznik)" });
  const scale = q("input", { type: "text", placeholder: "np. brak, lekko, mocno (skala)" });
  const detOn = q("input", { type: "checkbox" });
  const detType = q("select", {}, q("option", { value: "tags" }, "lista (tagi)"), q("option", { value: "counts" }, "liczniki per rodzaj (tylko dla licznika)"), q("option", { value: "number" }, "liczba"), q("option", { value: "text" }, "tekst (tylko notatka, nie do statystyk)"));
  const opts = q("input", { type: "text", placeholder: "np. Katar, Kaszel, Ból głowy (lista)" });
  const detOpts = q("input", { type: "text", placeholder: "Opcje szczegółu po przecinku (lista)" });
  const detLabel = q("input", { type: "text", placeholder: "Etykieta szczegółu, np. Ile minut?" });
  return h("div", { class: "card inner" }, h("h3", {}, "Dodaj pole"),
    labeled("Etykieta", label), labeled("Typ", type), labeled("Grupa", group), labeled("Jednostka", unit), labeled("Etykiety skali", scale), labeled("Opcje listy (po przecinku)", opts),
    h("label", { class: "f chk" }, detOn, h("span", {}, "Pole szczegółu (gdy wartość dodatnia)")), labeled("Typ szczegółu", detType), labeled("Etykieta szczegółu", detLabel), labeled("Opcje szczegółu (po przecinku)", detOpts),
    h("button", { class: "btn", onclick: () => {
      const l = label.value.trim();
      if (!l) return say("fld", "Podaj etykietę.", "bad");
      const t = type.value, f = { id: slug(l), label: l, type: t, group: group.value.trim() || "Inne", default: t === "bool" ? false : t === "text" ? "" : t === "tags" ? [] : 0 };
      if (t === "tags") f.options = parseOptions(opts.value);
      if (t === "count" && unit.value.trim()) f.unit = unit.value.trim();
      if (t === "scale") {
        const ls = scale.value.split(",").map(s => s.trim()).filter(Boolean);
        if (ls.length < 2) return say("fld", "Skala wymaga co najmniej 2 etykiet po przecinku.", "bad");
        Object.assign(f, { min: 0, max: ls.length - 1, scaleLabels: ls });
      }
      if (detOn.checked && detType.value === "counts" && t !== "count") return say("fld", "Liczniki per rodzaj działają tylko dla pola typu licznik.", "bad");
      if (detOn.checked) {
        f.detail = { type: detType.value, label: detLabel.value.trim() || "Szczegóły", showWhen: "positive", ...(detType.value === "number" && unit.value.trim() && t !== "count" ? { unit: unit.value.trim() } : {}) };
        if (detType.value === "tags" || detType.value === "counts") f.detail.options = parseOptions(detOpts.value);
      }
      f.active = true;
      S.edit.fields.push(f);
      redraw();
      toast("Dodano pole (zapisz pola, aby wysłać do repo)");
    } }, "Dodaj pole"));
}
