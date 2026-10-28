// HTTP access to grassyknees.com: one request at a time, a short in-memory cache, and an identifying User-Agent.
// The site sits behind a slow shared proxy, so this never fans out across metros.
export const VERSION = "0.1.0";
export const ORIGIN = (process.env.GRASSYKNEES_ORIGIN || "https://grassyknees.com").replace(/\/$/, "");
const USER_AGENT = `grassyknees-mcp/${VERSION} (+https://github.com/grassyknees/grassyknees-mcp)`;
const TIMEOUT_MS = 45_000;
const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 6;

type Entry = { at: number; value: unknown };
const cache = new Map<string, Entry>();
let queue: Promise<unknown> = Promise.resolve();

// Serialize every request: a new one starts only after the previous one finished.
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function get(path: string, accept: string): Promise<Response> {
  const res = await fetch(ORIGIN + path, {
    headers: { "User-Agent": USER_AGENT, Accept: accept },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new HttpError(res.status, `grassyknees.com answered ${res.status} for ${path}`);
  return res;
}

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    cache.delete(key); cache.set(key, hit); // keep recently used entries last
    return hit.value as T;
  }
  const value = await serial(load);
  cache.set(key, { at: Date.now(), value });
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  return value;
}

export function getJson<T>(path: string, useCache = true): Promise<T> {
  const load = async () => (await get(path, "application/json")).json() as Promise<T>;
  return useCache ? cached("json:" + path, load) : serial(load);
}

export function getText(path: string): Promise<string> {
  return cached("text:" + path, async () => (await get(path, "text/markdown, text/plain;q=0.9")).text());
}
