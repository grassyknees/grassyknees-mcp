# Grassy Knees MCP server

Website: https://grassyknees.com

A small, read-only [Model Context Protocol](https://modelcontextprotocol.io) server that lets AI assistants answer questions like *"what can I do with my kids in Denver this weekend?"* with real listings from [Grassy Knees](https://grassyknees.com). Grassy Knees is a free directory of kids' and family events, classes and places across 42 US metro areas. Every listing is researched from the organizer's own page and shows the date it was last checked.

Every result says what the listing is, where and when, ages, and its grassyknees.com page URL. Price, availability, the last-checked date, registration, the organizer's links and contact details are on that page. Each call returns at most 20 listings.

## Example prompts

- "What can I do with my kids in Denver this weekend?"
- "Free things for a 4-year-old in Washington, DC in the next 7 days."
- "Any STEM events for a 10-year-old in Seattle on Saturday?"
- "Where can we go ice skating near Chicago?"
- "Halloween events for kids in Austin."
- "Tell me more about https://grassyknees.com/denver/activities/rock-creek-farm-pumpkin-patch-and-corn-maze--listing-69c7739ea9ac9cfaddb69622"

## Install

Requires Node.js 20 or later. No API key needed.

### Claude Desktop

Add this to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "grassyknees": {
      "command": "npx",
      "args": ["-y", "grassyknees-mcp"]
    }
  }
}
```

### Claude Code

```sh
claude mcp add grassyknees -- npx -y grassyknees-mcp
```

### Cursor

Add this to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "grassyknees": {
      "command": "npx",
      "args": ["-y", "grassyknees-mcp"]
    }
  }
}
```

Any other MCP client that runs stdio servers works the same way: the command is `npx -y grassyknees-mcp`.

Or with Docker: build the image with `docker build -t grassyknees-mcp .` and use `docker run -i --rm grassyknees-mcp` as the command.

## Tools

| Tool | What it does |
| --- | --- |
| `list_metros` | The 42 metro areas covered, with the id to pass to other tools (for example `denver`, `new-york`, `washington-dc`, `dallas-fort-worth`) and each metro's page URL. |
| `search_activities` | Search one metro. Filters: `when` (`today`, `tomorrow`, `this-weekend`, `next-7-days`, `next-30-days`) or `start_date`/`end_date`, `kind` (`event`, `program`, `place`, `any`), `free_only`, `age`, `category`, `query` (keywords), `limit` (1–20, default 10). Soonest first. |
| `get_activity` | One listing from its grassyknees.com URL or id: schedule, upcoming dates, venue, ages and its page URL. |
| `seasonal_guide` | The Halloween, Christmas (lights and holiday events), ice skating or Easter guide for a metro, or the all-metros overview, as Markdown trimmed to `max_chars` (default 8,000). |

Dates are in the metro's local time. `this-weekend` means Friday to Sunday, the same window as the site's `/<metro>/this-weekend` page.

## Sample transcript

From `npm run smoke`, run against the live site on 2026-10-28 (trimmed):

```
tools: list_metros, search_activities, get_activity, seasonal_guide

=== search_activities {"metro":"denver","when":"this-weekend","limit":3}
60 events in Denver for this weekend (2026-10-30 to 2026-11-01); showing the first 3:

1. **[School's Out! Day: Pumpkins & Potions](https://grassyknees.com/denver/activities/school-s-out-day-pumpkins-and-potions--listing-023a33783babb5880fc24e03)**
   Fri, Oct 30 · 8:30 AM–3:30 PM · JCC Denver (Staenberg-Loup Jewish Community Center), 350 S. Dahlia St., Denver, CO 80246
   Ages 5+ · Arts & crafts

2. **[Rock Creek Farm Pumpkin Patch and Corn Maze](https://grassyknees.com/denver/activities/rock-creek-farm-pumpkin-patch-and-corn-maze--listing-69c7739ea9ac9cfaddb69622)**
   Fri, Oct 30 · 9:30 AM–7:00 PM (also other dates) · Rock Creek Farm, 2005 S 112th St., Broomfield, CO 80020
   Farm admission applies to ages 4 & up · Outdoors

3. **[JTML Hoppy Halloween Storytime](https://grassyknees.com/denver/activities/jtml-hoppy-halloween-storytime--listing-5ee8642f996422fe0023e407)**
   Fri, Oct 30 · 10:00 AM–11:00 AM · John Tomay Memorial Library, 605 6th Street, Georgetown, CO 80444
   Kids (event category) · Community

More on grassyknees.com: https://grassyknees.com/denver/this-weekend

=== search_activities {"metro":"DC","when":"this-weekend","free_only":true,"limit":3}
20 events, free in Washington, DC for this weekend (2026-10-30 to 2026-11-01); showing the first 3:

1. **[Play Day in the Park at Black Hill Discovery Center](https://grassyknees.com/washington-dc/activities/play-day-in-the-park-at-black-hill-discovery-center--listing-c17ea7ba367fd70feca1648e)**
   Fri, Oct 30 · 11:00 AM–12:00 PM (also other dates) · Black Hill Discovery Center, 20926 Lake Ridge Drive, Boyds, MD 20841
   Ages 6 mos to 3 yrs · Outdoors
...

=== get_activity {"url_or_id":"https://grassyknees.com/denver/activities/school-s-out-day-pumpkins-and-potions--listing-023a33783babb5880fc24e03"}
# School's Out! Day: Pumpkins & Potions
- When: Fri, Oct 30 · 8:30 AM–3:30 PM
- Where: JCC Denver (Staenberg-Loup Jewish Community Center), 350 S. Dahlia St., Denver, CO 80246
- Price, availability, registration, organizer links and contact: https://grassyknees.com/denver/activities/school-s-out-day-pumpkins-and-potions--listing-023a33783babb5880fc24e03
...

=== seasonal_guide {"season":"ice-skating","metro":"denver","max_chars":1500}
# Ice skating with kids in Denver
> 9 ice rinks, public skates, holiday skate nights and learn-to-skate classes for kids in the Denver–Aurora–Centennial area this winter, ...
[Trimmed to 1500 of 6484 characters. Full guide: https://grassyknees.com/denver/ice-skating (Markdown: https://grassyknees.com/denver/ice-skating.md)]
```

## How it gets data

Read-only, public endpoints on grassyknees.com, one request at a time:

- `GET /api/activities?city=<metro>&fields=list` for searches (one metro's current list, filtered and capped locally to 20 results),
- `GET /api/activities?ids=<id>` for `get_activity`,
- the site's Markdown pages (`/<metro>/<season>.md`) for `seasonal_guide`.

Responses are cached in memory for 10 minutes, so follow-up questions about the same metro don't refetch. Requests send `User-Agent: grassyknees-mcp/<version>`. Nothing is written to the site and no personal data is sent.

Set `GRASSYKNEES_ORIGIN` to point the server at another deployment (for testing).

## Development

```sh
npm install
npm run build
npm run smoke            # calls each tool once against the live site (4 requests)
npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list
```

## Credit

Data: Grassy Knees, [grassyknees.com](https://grassyknees.com). When you show results, link to the listing's grassyknees.com page. Details can change, so check the listing page (it links the organizer's own page) before you go.

## License

MIT for this server's code. Listing data belongs to Grassy Knees and is provided for lookups, not bulk copying.
