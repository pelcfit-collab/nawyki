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
