// Daty zawsze w Europe/Warsaw. Arytmetyka kalendarzowa na południu UTC (bez wpływu DST).
const TZ = "Europe/Warsaw";
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const nowFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "longOffset"
});

const p2 = n => String(n).padStart(2, "0");
const toUtc = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d, 12); };
const fromUtc = ms => { const d = new Date(ms); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`; };

export const todayStr = () => dayFmt.format(new Date());
export const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
export const addDays = (s, n) => fromUtc(toUtc(s) + n * 864e5);
export const ymd = (y, m, d) => `${y}-${p2(m)}-${p2(d)}`;
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const weekdayMon0 = s => (new Date(toUtc(s)).getUTCDay() + 6) % 7;
export const fmtLong = s => new Date(toUtc(s)).toLocaleDateString("pl-PL", { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" });
export const fmtMonth = (y, m) => new Date(Date.UTC(y, m - 1, 1, 12)).toLocaleDateString("pl-PL", { month: "long", year: "numeric", timeZone: "UTC" });

// ISO z offsetem warszawskim, np. 2026-11-05T21:03:12+01:00
export function nowIso(d = new Date()) {
  const p = Object.fromEntries(nowFmt.formatToParts(d).map(x => [x.type, x.value]));
  const off = p.timeZoneName.replace("GMT", "") || "+00:00";
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${off}`;
}
export const hm = iso => (iso || "").slice(11, 16);

// Bieżąca pełna godzina (0-23) w Europe/Warsaw, niezależnie od strefy urządzenia.
export const warsawHour = (d = new Date()) => parseInt(nowIso(d).slice(11, 13), 10);
