// Mały helper do budowania DOM (bez innerHTML, więc dane użytkownika są bezpieczne).
export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (["value", "checked", "disabled", "selected"].includes(k)) e[k] = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  const add = k => {
    if (k == null || k === false) return;
    if (Array.isArray(k)) k.forEach(add);
    else e.append(k.nodeType ? k : document.createTextNode(String(k)));
  };
  kids.forEach(add);
  return e;
}
export const $ = s => document.querySelector(s);

let toastTimer;
export function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}
