// Listing shape and date/price/age rules, mirroring how grassyknees.com itself filters and labels listings.
import { ORIGIN } from "./client.js";
import type { Metro } from "./metros.js";

export interface Activity {
  id: string; cityId: string; title: string; kind: "event" | "program" | "place"; category: string;
  description: string; venue: string; address: string; lat: number | null; lng: number | null;
  date: string | null; time: string | null; endDate: string | null; endTime: string | null;
  occurrenceDates?: string[]; excludedDates?: string[]; daysOfWeek?: number[]; schedule?: string;
  minAge: number | null; maxAge: number | null; ageLabel?: string;
  price: number | null; priceLabel?: string; costType?: "free" | "paid" | "unknown" | "conditional";
  availability?: "unknown" | "available" | "sold_out" | "cancelled" | "needs_confirmation";
  organizer: string; organizationName?: string; sourceUrl: string; website?: string; registrationUrl?: string;
  phone?: string; verifiedAt: string; curated?: boolean; inclusive?: string[];
  registrationOpens?: { date: string; time: string | null; audience?: string; sale?: boolean }[];
}

export const CATEGORIES = ["Outdoors", "Arts & crafts", "STEM & discovery", "Sports & play", "Community", "Cooking"] as const;

export function addDays(date: string, n: number) {
  const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
const weekday = (date: string) => new Date(date + "T12:00:00Z").getUTCDay();

export function metroToday(m: Metro, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: m.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// Same as the site's /<metro>/this-weekend page: Friday through Sunday, starting today once the weekend has begun.
export function weekendRange(today: string) {
  const dow = weekday(today);
  const friday = dow === 0 ? addDays(today, -2) : addDays(today, (5 - dow + 7) % 7);
  return { start: today > friday ? today : friday, end: addDays(friday, 2) };
}

export function lastDate(a: Activity) { return a.occurrenceDates?.at(-1) || a.endDate || a.date || null; }
export function isPast(a: Activity, today: string) { const end = lastDate(a); return !!end && end < today; }

// First day in [start, end] on which the listing happens, or null.
export function firstDayIn(a: Activity, start: string, end: string): string | null {
  if (a.occurrenceDates?.length) return a.occurrenceDates.find(d => d >= start && d <= end) ?? null;
  if (!a.date && !a.endDate) return null;
  const from = a.date && a.date > start ? a.date : start, to = a.endDate || a.date || end;
  for (let d = from; d <= end && d <= to; d = addDays(d, 1)) {
    if (a.excludedDates?.includes(d)) continue;
    if (a.daysOfWeek?.length && !a.daysOfWeek.includes(weekday(d))) continue;
    return d;
  }
  return null;
}

// Programs (classes, series) count when they run during the range; places are open-ended.
export function activeIn(a: Activity, start: string, end: string) {
  if (a.kind === "place") return true;
  if (a.kind === "program") {
    const last = lastDate(a);
    if (a.date && a.date > end) return false;
    return !last || last >= start;
  }
  return firstDayIn(a, start, end) !== null;
}

export function isFree(a: Activity) { return a.costType === "free" || (a.costType !== "paid" && a.costType !== "conditional" && a.price === 0); }

export function fitsAge(a: Activity, age: number) {
  return (a.minAge === null || a.minAge <= age) && (a.maxAge === null || a.maxAge >= age);
}

export function ageText(a: Activity) {
  if (a.ageLabel && /all ?ages|whole ?family/i.test(a.ageLabel)) return "All ages";
  if (a.minAge !== null && a.maxAge !== null) return `Ages ${a.minAge}–${a.maxAge}`;
  if (a.minAge !== null) return `Ages ${a.minAge}+`;
  if (a.maxAge !== null) return `Up to age ${a.maxAge}`;
  return a.ageLabel || "Check age guidance";
}

export function priceText(a: Activity) {
  const money = (n: number) => "$" + (Number.isInteger(n) ? n : n.toFixed(2));
  const base = isFree(a) ? "Free" : a.costType === "conditional" ? "With admission" : a.price !== null && a.price > 0 ? (a.curated ? `From ${money(a.price)}` : money(a.price)) : a.costType === "paid" ? "Paid" : "Check price";
  return a.priceLabel && a.priceLabel !== base ? `${base} (${clip(a.priceLabel, 90)})` : base;
}

const pretty = (d: string) => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(d + "T12:00:00Z"));
const clock = (t: string) => { const [h, m] = t.split(":"); return `${Number(h) % 12 || 12}:${m} ${Number(h) >= 12 ? "PM" : "AM"}`; };

export function whenText(a: Activity, day: string | null) {
  const time = a.time ? " · " + clock(a.time) + (a.endTime ? "–" + clock(a.endTime) : "") : "";
  if (a.kind === "place") return "Open on its own schedule (check hours)";
  if (a.kind === "program") return (a.schedule || (a.date ? `Runs ${pretty(a.date)}${a.endDate && a.endDate !== a.date ? " – " + pretty(a.endDate) : ""}` : "Recurring")) + time;
  if (day) {
    const more = (a.occurrenceDates?.length ?? 0) > 1 || (a.endDate && a.endDate !== a.date) ? " (also other dates)" : "";
    return pretty(day) + time + more;
  }
  return (a.date ? pretty(a.date) : "Check schedule") + time;
}

export function slugify(s: string) {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70).replace(/-+$/, "");
}
export function pageUrl(a: Activity) { return `${ORIGIN}/${a.cityId}/activities/${slugify(a.title) || "activity"}--${a.id}`; }

// Accepts a listing id, a grassyknees.com listing URL (with or without .md), or a bare slug.
export function idFromInput(input: string) {
  let s = input.trim();
  try { s = new URL(s).pathname; } catch { /* not a URL */ }
  s = s.replace(/\.md$/, "").replace(/\/+$/, "");
  const last = s.split("/").pop() || s;
  const i = last.lastIndexOf("--");
  return i < 0 ? last : last.slice(i + 2);
}

export function availabilityNote(a: Activity) {
  return a.availability === "cancelled" ? "Cancelled, according to the organizer."
    : a.availability === "sold_out" ? "Sold out on the organizer's page when last checked."
    : a.availability === "needs_confirmation" ? "Some details still need confirmation; check the organizer's page before going." : undefined;
}

export const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s);

// The bounded, attributed shape every tool returns for a listing: what, where and when, ages and price, and its grassyknees.com page.
// Organizer links, registration and contacts are left to that page.
export function summary(a: Activity, day: string | null) {
  return {
    title: a.title,
    url: pageUrl(a),
    kind: a.kind,
    category: a.category,
    when: whenText(a, day),
    ...(day ? { date: day } : {}),
    venue: a.venue,
    address: a.address,
    ages: ageText(a),
    price: priceText(a),
    organizer: a.organizationName || a.organizer,
    lastChecked: a.verifiedAt,
    ...(availabilityNote(a) ? { note: availabilityNote(a) } : {}),
    ...(a.inclusive?.length ? { tags: a.inclusive } : {}),
    description: clip(a.description || "", 220),
  };
}
export type Summary = ReturnType<typeof summary>;

export function summaryMarkdown(s: Summary, n?: number) {
  const head = `${n ? n + ". " : ""}**[${s.title}](${s.url})**`;
  const lines = [
    head,
    `   ${s.when} · ${s.venue}${s.address ? ", " + s.address : ""}`,
    `   ${s.ages} · ${s.price} · ${s.category} · last checked ${s.lastChecked}`,
  ];
  if (s.note) lines.push(`   Note: ${s.note}`);
  if (s.description) lines.push(`   ${s.description}`);
  return lines.join("\n");
}
