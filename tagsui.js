// Widget wyboru tagów (chipy + pole „Dodaj…” z podpowiedziami) dla ekranu Dziś.
import { S, ls, queue } from "./state.js";
import { h } from "./ui.js";
import * as T from "./tags.js";
import * as D from "./dates.js";

// Opcje pola łącznie z oczekującymi (jeszcze niezapisanymi do config.json) dodaniami i reaktywacjami.
export function effectiveOptions(f, where) {
  const base = T.optContainer(f, where)?.options || [];
  const pend = S.draft.pending.filter(p => p.fid === f.id && p.where === where);
  const react = new Set(pend.filter(p => p.kind === "react").map(p => p.id));
  const opts = base.map(o => (react.has(o.id) ? { ...o, active: undefined } : o));
  for (const p of pend) if (p.kind === "add" && !opts.some(o => o.id === p.id)) opts.push({ id: p.id, label: p.label });
  return opts;
}

// Liczność użycia w ostatnich ~60 dniach (cache dni + kolejka).
function usage(f, where, opts) {
  const since = D.addDays(D.todayStr(), -60);
  const days = Object.entries(ls("days", {})).map(([date, e]) => ({ date, ...(e?.data || {}) }));
  for (const q of queue()) days.push({ ...q.data, date: q.date });
  return T.countUsage(days, f.id, where, opts, since);
}

export function tagsWidget(f, where, touch) {
  const store = () => (where === "main" ? S.draft.values : S.draft.details);
  const sel = () => (Array.isArray(store()[f.id]) ? store()[f.id] : []);
  const setSel = a => { store()[f.id] = a; touch(); };
  const pending = () => S.draft.pending;
  const counts = usage(f, where, effectiveOptions(f, where));

  const chipsEl = h("div", { class: "tagchips" }), suggEl = h("div", { class: "sugg" });
  const input = h("input", { type: "text", placeholder: "Dodaj…", autocomplete: "off", enterkeyhint: "done", "aria-label": "Dodaj: " + (T.optContainer(f, where)?.label || f.label) });

  function toggle(id) {
    const s = sel();
    if (s.includes(id)) {
      setSel(s.filter(x => x !== id));
      S.draft.pending = pending().filter(p => !(p.fid === f.id && p.where === where && p.id === id)); // niewybrane = bez zmiany w config
    } else setSel([...s, id]);
    draw();
  }
  function pick(o) {
    const eff = effectiveOptions(f, where);
    const cur = eff.find(x => x.id === o.id) || o;
    if (cur.active === false && !pending().some(p => p.fid === f.id && p.where === where && p.id === o.id))
      pending().push({ fid: f.id, where, kind: "react", id: o.id, label: o.label });
    if (!sel().includes(o.id)) setSel([...sel(), o.id]);
    input.value = ""; draw();
  }
  function addNew(text) {
    const label = T.capFirst(text);
    if (!label) return;
    const eff = effectiveOptions(f, where), m = T.findMatch(eff, label);
    if (m) return pick(m);
    const id = T.uniqueSlug(label, eff);
    pending().push({ fid: f.id, where, kind: "add", id, label });
    setSel([...sel(), id]);
    input.value = ""; draw();
  }

  function draw() {
    const eff = effectiveOptions(f, where), selected = new Set(sel());
    const shown = eff.filter(o => T.isVisible(o) || selected.has(o.id));
    for (const id of selected) if (!eff.some(o => o.id === id)) shown.push({ id, label: id });
    chipsEl.replaceChildren(...T.rankOptions(shown, counts).map(o =>
      h("button", { type: "button", class: "tagchip" + (selected.has(o.id) ? " on" : ""), "aria-pressed": String(selected.has(o.id)),
        onclick: () => toggle(o.id) }, o.label)));
    if (!shown.length) chipsEl.replaceChildren(h("span", { class: "hint" }, "Brak opcji. Wpisz poniżej, aby dodać pierwszą."));

    const q = input.value, rows = [];
    if (T.normalize(q)) {
      const m = T.findMatch(eff, q), list = T.suggest(eff, q, [...selected]);
      if (m && !selected.has(m.id) && !list.some(o => o.id === m.id)) list.unshift(m);
      for (const o of list) rows.push(h("button", { type: "button", class: "sugg-i", onclick: () => pick(o) },
        o.label, o.active === false ? h("small", {}, " (ukryta, przywróć)") : null));
      if (!m) rows.push(h("button", { type: "button", class: "sugg-i add", onclick: () => addNew(q) }, `+ Dodaj „${T.capFirst(q)}”`));
    }
    suggEl.replaceChildren(...rows);
  }

  input.addEventListener("input", draw);
  input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addNew(input.value); } });
  draw();
  return h("div", { class: "tags" }, chipsEl, input, suggEl);
}

/* ---------- v3: liczniki per rodzaj (`counts`) ---------- */

const expanded = new Set(); // pola rozwinięte ręcznie (przeżywa przerysowanie ekranu)
const collapsed = new Set(); // pola zwinięte ręcznie mimo sumy > 0

// Wiersz pola `count` z detalem `counts`: suma + rozwijana lista rodzajów z − liczba +.
export function countsWidget(f, touch) {
  const where = "detail", D_ = S.draft;
  const split = () => (D_.details[f.id] ||= {});
  const noSplit = () => D_.noSplit?.[f.id] || 0;
  const pending = () => S.draft.pending;
  const counts = usage(f, where, effectiveOptions(f, where));
  const label = f.detail.label || "Rodzaj";

  const sumEl = h("output", {}), toggleBtn = h("button", { type: "button", class: "btn ghost small" });
  const infoEl = h("div"), rowsEl = h("div", { class: "cntrows" }), suggEl = h("div", { class: "sugg" });
  const input = h("input", { type: "text", placeholder: "Dodaj rodzaj…", autocomplete: "off", enterkeyhint: "done", "aria-label": "Dodaj rodzaj: " + f.label });
  const body = h("div", { class: "detail" }, h("span", {}, label), infoEl, rowsEl, input, suggEl);

  const total = () => T.dayTotal(split(), noSplit());
  function change() { D_.values[f.id] = total(); touch(); draw(); }
  const timed = T.withTime(f);
  const timesOf = () => ((D_.times ||= {})[f.id] ||= {});
  let openChip = null; // { id, i } - chip, którego wybór godziny ma się otworzyć po przerysowaniu
  // v4: po jednym chipie na porcję; natywny <select> przykrywa chip.
  function chipsRow(o, n) {
    const arr = T.fitTimes(timesOf()[o.id], n);
    return h("div", { class: "timechips" }, arr.map((hr, i) => {
      const sel = h("select", { "data-k": o.id, "data-i": String(i), "aria-label": `${o.label}, porcja ${i + 1}: godzina`,
        onchange: e => { const v = e.target.value; timesOf()[o.id] = T.setHour(arr, i, v === "" ? null : Number(v)); D_.values[f.id] = total(); touch(); draw(); } },
        h("option", { value: "", selected: hr === null }, "nie pamiętam"),
        T.HOURS.map(x => h("option", { value: String(x), selected: hr === x }, T.fmtHour(x))));
      return h("span", { class: "timechip" + (hr === null ? " unknown" : "") }, T.fmtHour(hr), sel);
    }));
  }

  function setN(id, n) {
    const s = split(), old = s[id] || 0;
    if (timed) {
      const tm = timesOf();
      let arr = T.fitTimes(tm[id], old);
      if (n > old) {
        const hr = T.newPortionHour(S.date, D.todayStr(), D.warsawHour());
        arr = T.addPortion(arr, hr);
        if (hr === null) openChip = { id, i: arr.length - 1 }; // dzień przeszły: od razu wybór godziny
      } else if (n < old) arr = T.removePortion(arr);
      if (n > 0) tm[id] = arr; else delete tm[id];
    }
    if (n > 0) s[id] = n; else {
      delete s[id];
      S.draft.pending = pending().filter(p => !(p.fid === f.id && p.where === where && p.id === id && p.kind === "add")); // wyzerowane = bez zmiany w config
    }
    change();
  }
  function pick(o) {
    const eff = effectiveOptions(f, where), cur = eff.find(x => x.id === o.id) || o;
    if (cur.active === false && !pending().some(p => p.fid === f.id && p.where === where && p.id === o.id))
      pending().push({ fid: f.id, where, kind: "react", id: o.id, label: o.label });
    if (!(split()[o.id] > 0)) setN(o.id, 1);
    input.value = ""; draw();
  }
  function addNew(text) {
    const lab = T.capFirst(text);
    if (!lab) return;
    const eff = effectiveOptions(f, where), m = T.findMatch(eff, lab);
    if (m) return pick(m);
    const id = T.uniqueSlug(lab, eff);
    pending().push({ fid: f.id, where, kind: "add", id, label: lab });
    setN(id, 1); input.value = ""; draw();
  }

  function draw() {
    const eff = effectiveOptions(f, where), s = split(), t = total(), open = !collapsed.has(f.id) && (expanded.has(f.id) || t > 0);
    const kinds = D_.legacyKinds?.[f.id] || [];
    const brief = Object.entries(s).filter(([, n]) => n > 0).map(([id, n]) => `${eff.find(o => o.id === id)?.label || id} ×${n}`).join(", ");
    sumEl.replaceChildren(`${t}`, ...[f.unit ? h("small", {}, " " + f.unit) : null,
      !open && brief ? h("small", { class: "brief" }, brief) : null].filter(Boolean));
    toggleBtn.textContent = open ? "Zwiń" : "Rodzaje";
    toggleBtn.setAttribute("aria-expanded", String(open));
    body.hidden = !open;

    infoEl.replaceChildren();
    if (noSplit() > 0 && T.sumCounts(s) === 0) infoEl.append(h("p", { class: "legacy" }, `bez podziału: ${noSplit()} `,
      h("button", { type: "button", class: "btn ghost small", onclick: () => { D_.noSplit[f.id] = 0; change(); } }, "Wyzeruj")));
    if (kinds.length && T.sumCounts(s) === 0) infoEl.append(h("p", { class: "legacy" },
      "wcześniej zaznaczone bez liczby: " + kinds.map(id => eff.find(o => o.id === id)?.label || id).join(", ")));

    const shown = eff.filter(o => T.isVisible(o) || s[o.id] > 0 || kinds.includes(o.id));
    for (const id of Object.keys(s)) if (!eff.some(o => o.id === id)) shown.push({ id, label: id });
    rowsEl.replaceChildren(...T.rankOptions(shown, counts).map(o => {
      const n = s[o.id] || 0;
      const row = h("div", { class: "row cnt" }, h("span", { class: "lbl" }, o.label),
        h("div", { class: "stepper" },
          h("button", { type: "button", "aria-label": "Mniej: " + o.label, disabled: n <= 0, onclick: () => setN(o.id, n - 1) }, "−"),
          h("output", {}, String(n)),
          h("button", { type: "button", "aria-label": "Więcej: " + o.label, onclick: () => setN(o.id, n + 1) }, "+")));
      if (timed && n > 0) row.append(chipsRow(o, n));
      return row;
    }));
    if (openChip) { const oc = openChip; openChip = null; setTimeout(() => { const sel = rowsEl.querySelector(`select[data-k="${oc.id}"][data-i="${oc.i}"]`); try { sel?.showPicker(); } catch { sel?.focus(); } }, 0); }
    if (!shown.length) rowsEl.replaceChildren(h("span", { class: "hint" }, "Brak rodzajów. Wpisz poniżej, aby dodać pierwszy."));

    const q = input.value, rows = [];
    if (T.normalize(q)) {
      const m = T.findMatch(eff, q), list = T.suggest(eff, q, Object.keys(s).filter(k => s[k] > 0));
      if (m && !(s[m.id] > 0) && !list.some(o => o.id === m.id)) list.unshift(m);
      for (const o of list) rows.push(h("button", { type: "button", class: "sugg-i", onclick: () => pick(o) },
        o.label, o.active === false ? h("small", {}, " (ukryty, przywróć)") : null));
      if (!m) rows.push(h("button", { type: "button", class: "sugg-i add", onclick: () => addNew(q) }, `+ Dodaj „${T.capFirst(q)}”`));
    }
    suggEl.replaceChildren(...rows);
  }

  toggleBtn.addEventListener("click", () => {
    const isOpen = !body.hidden;
    if (isOpen) { collapsed.add(f.id); expanded.delete(f.id); } else { collapsed.delete(f.id); expanded.add(f.id); }
    draw();
  });
  input.addEventListener("input", draw);
  input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addNew(input.value); } });
  draw();
  return h("div", { class: "wide" }, h("div", { class: "row wide" }, h("span", { class: "lbl" }, f.label), sumEl, toggleBtn), body);
}
