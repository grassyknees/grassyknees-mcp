#!/usr/bin/env node
// Grassy Knees MCP server (stdio, read-only). Data: Grassy Knees, https://grassyknees.com
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ORIGIN, VERSION, getJson, getText, HttpError } from "./client.js";
import { METROS, type Metro } from "./metros.js";
import {
  CATEGORIES, type Activity, type Summary, activeIn, addDays, clip, firstDayIn, fitsAge, idFromInput, isFree, isPast,
  metroToday, pageUrl, summary, summaryMarkdown, weekendRange,
} from "./listings.js";

const MAX_RESULTS = 20;
const CREDIT = "Data: Grassy Knees (https://grassyknees.com). Each listing was researched from the organizer's own page; link to the listing URL and mention the last-checked date. Registration, the organizer's links and contact details are on the listing's grassyknees.com page.";

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const ALIASES: Record<string, string> = {
  nyc: "new-york", "new york city": "new-york", la: "los-angeles", dc: "washington-dc", washington: "washington-dc",
  dallas: "dallas-fort-worth", "fort worth": "dallas-fort-worth", dfw: "dallas-fort-worth", sf: "san-francisco",
  "bay area": "san-francisco", "inland empire": "riverside", "san bernardino": "riverside", philly: "philadelphia",
  okc: "oklahoma-city", "twin cities": "minneapolis", "st paul": "minneapolis", "saint louis": "st-louis", vegas: "las-vegas", kc: "kansas-city",
};
function findMetro(input: string): Metro | undefined {
  const q = norm(input).replace(/\b(metro|area|city)\b/g, "").trim();
  const byId = METROS.find(m => norm(m.id) === q || norm(m.name) === q);
  if (byId) return byId;
  const alias = ALIASES[q];
  if (alias) return METROS.find(m => m.id === alias);
  if (q.length < 4) return undefined;
  return METROS.find(m => q.startsWith(norm(m.name)) || norm(m.metro).includes(q));
}
const unknownMetro = (input: string) => fail(`"${input}" is not one of the ${METROS.length} metro areas Grassy Knees covers. Call list_metros for the ids (for example denver, new-york, washington-dc, dallas-fort-worth).`);

function fail(text: string) { return { content: [{ type: "text" as const, text }], isError: true }; }
function ok(text: string, structured: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text }], structuredContent: structured };
}
function httpFail(e: unknown, what: string) {
  if (e instanceof HttpError && e.status === 404) return fail(`${what} was not found on grassyknees.com.`);
  return fail(`${what} could not be loaded from grassyknees.com right now (${e instanceof Error ? e.message : String(e)}). Try again in a minute.`);
}

const server = new McpServer(
  { name: "grassyknees-mcp", title: "Grassy Knees: kids' events and places", version: VERSION, websiteUrl: ORIGIN },
  {
    instructions: `Grassy Knees (${ORIGIN}) lists real, source-checked kids' and family events, classes and places in ${METROS.length} US metro areas. ` +
      "Use search_activities for questions like 'what can I do with my kids in Denver this weekend'. Results are capped at 20 per call. " +
      "When answering, link each listing to its grassyknees.com url, mention its last-checked date, and credit Grassy Knees.",
  },
);

server.registerTool("list_metros", {
  title: "List covered metro areas",
  description: `List the ${METROS.length} US metro areas Grassy Knees covers, with the metro id to pass to the other tools and each metro's page URLs.`,
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: false },
}, async () => {
  const metros = METROS.map(m => ({ id: m.id, name: m.name, metroArea: m.metro, states: m.states, timeZone: m.timeZone, url: `${ORIGIN}/${m.id}`, thisWeekendUrl: `${ORIGIN}/${m.id}/this-weekend` }));
  const text = `Grassy Knees covers ${metros.length} US metro areas (id: name, states):\n` +
    metros.map(m => `- ${m.id}: ${m.name} (${m.states}) ${m.url}`).join("\n") + `\n\n${CREDIT}`;
  return ok(text, { metros, credit: CREDIT });
});

const WHEN = ["today", "tomorrow", "this-weekend", "next-7-days", "next-30-days"] as const;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

server.registerTool("search_activities", {
  title: "Search kids' activities in a metro",
  description: "Find kids' and family events, classes/programs and places in one Grassy Knees metro area, filtered by date, price, age, category and keywords. " +
    `Returns at most ${MAX_RESULTS} listings, soonest first, each with its grassyknees.com page URL and the last-checked date. ` +
    "Dates are in the metro's local time.",
  inputSchema: {
    metro: z.string().describe("Metro id from list_metros (e.g. denver, new-york, washington-dc, dallas-fort-worth). Common names like 'NYC' or 'Dallas' also work."),
    when: z.enum(WHEN).optional().describe("Date window. Default next-7-days. Ignored when start_date is given."),
    start_date: date.optional().describe("Start of a custom date range, YYYY-MM-DD (metro local time)."),
    end_date: date.optional().describe("End of the custom range, YYYY-MM-DD. Defaults to start_date."),
    kind: z.enum(["event", "program", "place", "any"]).optional().describe("event = dated one-offs (default); program = classes and multi-week series; place = museums, parks, rinks and other places to go; any = all three."),
    free_only: z.boolean().optional().describe("Only free listings."),
    age: z.number().int().min(0).max(18).optional().describe("Child's age in years; keeps listings whose published age range includes it (listings without an age range are kept)."),
    category: z.enum(CATEGORIES).optional(),
    query: z.string().max(100).optional().describe("Keywords matched against title, description, venue, organizer and address (all words must match), e.g. 'pumpkin', 'library storytime', 'Boulder'."),
    limit: z.number().int().min(1).max(MAX_RESULTS).optional().describe(`How many listings to return, 1–${MAX_RESULTS} (default 10).`),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
}, async args => {
  const m = findMetro(args.metro);
  if (!m) return unknownMetro(args.metro);
  const today = metroToday(m);
  let start = today, end = addDays(today, 6), label = "the next 7 days";
  if (args.start_date) {
    start = args.start_date; end = args.end_date && args.end_date >= start ? args.end_date : start;
    if (end > addDays(start, 92)) end = addDays(start, 92);
    label = start === end ? start : `${start} to ${end}`;
  } else if (args.when === "today") { end = today; label = "today"; }
  else if (args.when === "tomorrow") { start = end = addDays(today, 1); label = "tomorrow"; }
  else if (args.when === "this-weekend") { ({ start, end } = weekendRange(today)); label = `this weekend (${start} to ${end})`; }
  else if (args.when === "next-30-days") { end = addDays(today, 29); label = "the next 30 days"; }
  const kind = args.kind ?? "event", limit = args.limit ?? 10;
  const terms = args.query ? norm(args.query).split(" ").filter(Boolean) : [];

  let all: Activity[];
  try { all = (await getJson<{ activities: Activity[] }>(`/api/activities?city=${m.id}&fields=list`)).activities; }
  catch (e) { return httpFail(e, `The ${m.name} listings`); }

  const hits: { a: Activity; day: string | null }[] = [];
  for (const a of all) {
    if (a.availability === "cancelled" || isPast(a, start < today ? start : today)) continue;
    if (kind !== "any" && a.kind !== kind) continue;
    if (!activeIn(a, start, end)) continue;
    if (args.free_only && !isFree(a)) continue;
    if (args.age !== undefined && !fitsAge(a, args.age)) continue;
    if (args.category && a.category !== args.category) continue;
    if (terms.length) {
      const hay = norm([a.title, a.description, a.venue, a.organizer, a.organizationName, a.address].join(" "));
      if (!terms.every(t => hay.includes(t))) continue;
    }
    hits.push({ a, day: a.kind === "event" ? firstDayIn(a, start, end) : null });
  }
  const rank = (k: string) => (k === "event" ? 0 : k === "program" ? 1 : 2);
  hits.sort((x, y) => rank(x.a.kind) - rank(y.a.kind) || (x.day || "").localeCompare(y.day || "") || (x.a.time || "99").localeCompare(y.a.time || "99") || x.a.title.localeCompare(y.a.title));
  const results: Summary[] = hits.slice(0, limit).map(h => summary(h.a, h.day));

  const filters = [kind === "any" ? "events, programs and places" : kind + "s", args.free_only && "free", args.age !== undefined && `age ${args.age}`, args.category, terms.length && `matching "${args.query}"`].filter(Boolean).join(", ");
  const browse = args.when === "this-weekend" ? `${ORIGIN}/${m.id}/this-weekend` : `${ORIGIN}/${m.id}`;
  const text = results.length
    ? `${hits.length} ${filters} in ${m.name} for ${label}${hits.length > results.length ? `; showing the first ${results.length}` : ""}:\n\n` +
      results.map((r, i) => summaryMarkdown(r, i + 1)).join("\n\n") + `\n\nMore on grassyknees.com: ${browse}\n${CREDIT}`
    : `No ${filters} found in ${m.name} for ${label}. Try a wider date range, kind "any", or fewer filters. Browse: ${browse}\n${CREDIT}`;
  return ok(text, { metro: m.id, metroName: m.name, start, end, matched: hits.length, returned: results.length, results, browseUrl: browse, credit: CREDIT });
});

server.registerTool("get_activity", {
  title: "Get one listing",
  description: "Details for one Grassy Knees listing: schedule and upcoming dates, venue, ages, price, last-checked date and its grassyknees.com page (registration and organizer links are there). Pass the grassyknees.com listing URL or the listing id (listing-…) from search_activities.",
  inputSchema: { url_or_id: z.string().min(3).max(500).describe("A grassyknees.com listing URL such as https://grassyknees.com/denver/activities/<slug>--listing-…, or its id.") },
  annotations: { readOnlyHint: true, openWorldHint: true },
}, async ({ url_or_id }) => {
  const id = idFromInput(url_or_id);
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(id)) return fail(`"${url_or_id}" does not look like a Grassy Knees listing URL or id.`);
  let a: Activity | undefined;
  try { a = (await getJson<{ activities: Activity[] }>(`/api/activities?ids=${encodeURIComponent(id)}`, false)).activities[0]; }
  catch (e) { return httpFail(e, "That listing"); }
  if (!a) return fail(`No public listing with id ${id} on grassyknees.com (it may have been removed).`);
  const m = METROS.find(x => x.id === a!.cityId);
  const today = m ? metroToday(m) : new Date().toISOString().slice(0, 10);
  const next = a.kind === "event" ? firstDayIn(a, today, addDays(today, 366)) : null;
  const s = summary(a, next);
  const detail = {
    ...s,
    description: clip(a.description || "", 500),
    ...(a.schedule ? { schedule: a.schedule } : {}),
    ...(a.occurrenceDates?.length ? { upcomingDates: a.occurrenceDates.filter(d => d >= today).slice(0, 12) } : {}),
    ended: isPast(a, today),
    metro: a.cityId,
    markdownUrl: pageUrl(a) + ".md",
  };
  const lines = [
    `# ${a.title}`, `${detail.url}`, BREAK,
    `- When: ${s.when}${detail.schedule ? ` (${detail.schedule})` : ""}${detail.ended ? " (this listing has ended)" : ""}`,
    detail.upcomingDates && detail.upcomingDates.length > 1 ? `- Upcoming dates: ${detail.upcomingDates.join(", ")}` : "",
    `- Where: ${a.venue}${a.address ? ", " + a.address : ""}`,
    `- Ages: ${s.ages}`, `- Price: ${s.price}`, `- Category: ${a.category} (${a.kind})`, `- Organizer: ${s.organizer}`,
    `- Registration, organizer links and contact: ${detail.url}`,
    `- Last checked: ${a.verifiedAt}`, s.note ? `- Note: ${s.note}` : "", BREAK, detail.description, BREAK, CREDIT,
  ].filter(l => l !== ""); // optional rows are "" when absent
  const text = lines.map(l => (l === BREAK ? "" : l)).join("\n");
  return ok(text, { activity: detail, credit: CREDIT });
});

const BREAK = "\u0000";
const SEASONS = ["halloween", "christmas", "ice-skating", "easter"] as const;
server.registerTool("seasonal_guide", {
  title: "Seasonal guide",
  description: "Grassy Knees' seasonal guide (Halloween events, Christmas lights and holiday events, ice skating rinks, Easter egg hunts) for one metro, or the national overview when metro is omitted. " +
    "Returns the page's Markdown (quick answers plus listings with links, ages, prices and last-checked dates), trimmed to max_chars.",
  inputSchema: {
    season: z.enum(SEASONS),
    metro: z.string().optional().describe("Metro id from list_metros. Omit for the all-metros overview."),
    max_chars: z.number().int().min(1000).max(20000).optional().describe("Trim the Markdown to this many characters (default 8000)."),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
}, async ({ season, metro, max_chars }) => {
  let path = `/${season}`;
  if (metro) { const m = findMetro(metro); if (!m) return unknownMetro(metro); path = `/${m.id}/${season}`; }
  let md: string;
  try { md = await getText(path + ".md"); } catch (e) { return httpFail(e, `The ${season} guide`); }
  const max = max_chars ?? 8000;
  let body = md;
  if (md.length > max) {
    const cut = md.lastIndexOf("\n", max);
    body = md.slice(0, cut > max / 2 ? cut : max).trimEnd() + `\n\n[Trimmed to ${max} of ${md.length} characters. Full guide: ${ORIGIN}${path} (Markdown: ${ORIGIN}${path}.md)]`;
  }
  return ok(`${body}\n\n${CREDIT}`, { url: ORIGIN + path, markdownUrl: ORIGIN + path + ".md", season, metro: metro ?? null, truncated: md.length > max, credit: CREDIT });
});

await server.connect(new StdioServerTransport());
