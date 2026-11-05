// Klient GitHub REST API. Token trafia wyłącznie do https://api.github.com i nigdy nie jest logowany.
import { APP } from "./config.js";

const BASE = "https://api.github.com";
const TOKEN_KEY = "nawyki.token";

export const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
export const setToken = t => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
// Brak sieci: fetch rzuca TypeError.
export const isOffline = e => e instanceof TypeError || (e instanceof ApiError && e.status === 0 && !navigator.onLine);

export function describe(e) {
  if (isOffline(e)) return "brak połączenia";
  if (e instanceof ApiError) {
    if (e.status === 401) return "token nieprawidłowy lub wygasł";
    if (e.status === 403) return "brak uprawnień lub limit zapytań";
    if (e.status === 404) return "nie znaleziono (sprawdź uprawnienia tokenu)";
    return `${e.status} ${e.message}`;
  }
  return String(e && e.message || e);
}

// UTF-8 <-> base64 (btoa/atob same w sobie psują polskie znaki)
export function b64enc(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function b64dec(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

const repo = `/repos/${APP.owner}/${APP.dataRepo}`;

async function req(method, path, body) {
  const token = getToken();
  if (!token) throw new ApiError(401, "brak tokenu");
  const res = await fetch(BASE + path, {
    method, cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).message || msg; } catch { /* ignoruj */ }
    throw new ApiError(res.status, msg);
  }
  return res.json();
}

export const checkRepo = () => req("GET", repo);

// Lista zapisanych dni (YYYY-MM-DD) z drzewa repo.
export async function listDays() {
  const t = await req("GET", `${repo}/git/trees/${APP.branch}?recursive=1`);
  return t.tree.map(x => /^days\/(\d{4}-\d{2}-\d{2})\.json$/.exec(x.path)).filter(Boolean).map(m => m[1]);
}

// -> { data, sha } albo null gdy pliku nie ma
export async function getFile(path) {
  try {
    const r = await req("GET", `${repo}/contents/${path}?ref=${APP.branch}`);
    return { data: JSON.parse(b64dec(r.content)), sha: r.sha };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

// Zapis JSON. build(remote) zwraca obiekt do zapisania; przy pierwszej próbie remote === undefined,
// po konflikcie sha (409/422) pobiera świeży plik i ponawia raz (remote = {data,sha} | null).
export async function saveJson(path, message, build, sha) {
  let remote;
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await req("PUT", `${repo}/contents/${path}`, {
        message, branch: APP.branch,
        content: b64enc(JSON.stringify(build(remote), null, 2) + "\n"),
        ...(sha ? { sha } : {})
      });
      return { sha: r.content.sha };
    } catch (e) {
      if (attempt === 0 && e instanceof ApiError && (e.status === 409 || e.status === 422)) {
        remote = await getFile(path);
        sha = remote ? remote.sha : undefined;
        continue;
      }
      throw e;
    }
  }
}
