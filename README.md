<p align="center"><img src="assets/logo-wordmark.svg" alt="jagir" width="360"></p>

# jagir-mcp

MCP server to search and compare short-term rentals on **Jabama**, **Jajiga** and **Otaghak** (Iran) from Claude and other MCP clients.

Read-only: it searches, shows details, calendars and price quotes. It never logs in or books anything.

## Tools

| Tool | What it does |
|---|---|
| `search_stays` | Search a city on all three platforms at once; merged, normalized results (Toman) |
| `get_stay` | Everything about one stay: amenities, rules, rating breakdown (incl. cleanliness), beds, area, view/setting, distances, all photos |
| `get_reviews` | Guest reviews with full text, rating, host reply and (Otaghak) positive/negative points |
| `get_stay_calendar` | Per-night availability and price |
| `get_quote` | Exact price for dates + guests (extra guests, fees) |
| `resolve_location` | How a city name is known on each platform |

Stay ids look like `jabama:800749`, `jajiga:3237270`, `otaghak:2397109`. Dates accept Gregorian (`2026-10-15`) or Jalali (`1405-07-23`). All prices are **Toman**.

## Install

Requires Node.js 20+.

### Claude Desktop (extension)

Build the bundle with `npm run pack:mcpb`, then double-click `jagir.mcpb` (or drag it into Settings → Extensions). Claude Desktop runs it with its built-in Node.js and shows the Jagir icon.

### Claude Desktop (manual config)

`claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "jagir": { "command": "npx", "args": ["-y", "jagir-mcp"] }
  }
}
```

### Claude Code

```bash
claude mcp add jagir -- npx -y jagir-mcp
```

## Example prompts

- «یه ویلا تو رامسر برای ۴ نفر از ۲۳ تا ۲۵ مهر پیدا کن، ارزون‌ترین‌ها رو از هر سه سایت مقایسه کن»
- "Find stays in Kish for 2 guests next weekend under 3 million Toman per night, sorted by rating"

## How it works

Each platform has an adapter that calls the public JSON API its own website uses and maps results to one schema. These APIs are undocumented and may change; if a platform breaks, the others still return results and the failure is listed in `errors`.

Price notes:
- With dates, `price.total` is the stay total for the requested guests as the platform's search reports it; `get_quote` adds service fees where the platform charges them (Jajiga).
- Otaghak quotes are computed from its calendar and extra-guest price (`estimated: true`).

## Development

```bash
npm install
npm test            # unit tests against recorded fixtures
npm run test:live   # hits the real platforms
npm run build
```

## Disclaimer

Not affiliated with Jabama, Jajiga or Otaghak. Prices and availability come from the platforms and can change; confirm on the platform before booking.
