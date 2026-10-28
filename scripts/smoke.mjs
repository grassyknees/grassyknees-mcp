// Sequential live smoke test: starts the built server over stdio and calls each tool once (4 HTTP requests in all).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const client = new Client({ name: "grassyknees-smoke", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))], stderr: "inherit", env: process.env }));
const { tools } = await client.listTools();
console.log("tools:", tools.map(t => t.name).join(", "));

const show = (label, r, n = 1800) => { console.log(`\n=== ${label}${r.isError ? " (ERROR)" : ""}`); console.log(r.content[0].text.slice(0, n)); return r; };
const metro = process.argv[2] || "denver";

show("list_metros", await client.callTool({ name: "list_metros", arguments: {} }), 400);
const s = show(`search_activities ${metro} this-weekend limit 3`, await client.callTool({ name: "search_activities", arguments: { metro, when: "this-weekend", limit: 3 } }));
// Same metro again, so this one is served from the in-memory cache (no request).
show(`search_activities ${metro} free, age 4, next-7-days, limit 3`, await client.callTool({ name: "search_activities", arguments: { metro, when: "next-7-days", free_only: true, age: 4, limit: 3 } }));
const first = s.structuredContent?.results?.[0]?.url;
if (first) show(`get_activity ${first}`, await client.callTool({ name: "get_activity", arguments: { url_or_id: first } }));
show(`seasonal_guide ice-skating ${metro}`, await client.callTool({ name: "seasonal_guide", arguments: { season: "ice-skating", metro, max_chars: 1500 } }));
await client.close();
