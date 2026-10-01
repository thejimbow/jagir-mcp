<p align="center">
  <img src="https://raw.githubusercontent.com/thejimbow/jagir-mcp/main/assets/banner.png" alt="Jagir: search and compare vacation rentals across Jabama, Jajiga and Otaghak from Claude" width="100%">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/jagir-mcp"><img src="https://img.shields.io/npm/v/jagir-mcp?color=0E8A63&label=npm" alt="npm version"></a>
  <a href="https://github.com/thejimbow/jagir-mcp/releases/latest"><img src="https://img.shields.io/github/v/release/thejimbow/jagir-mcp?color=0E8A63&label=Claude%20Desktop%20extension" alt="Claude Desktop extension"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0E8A63" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A520-0E8A63" alt="Node 20+">
  <img src="https://img.shields.io/badge/MCP-read--only-1DB584" alt="Read-only MCP server">
</p>

<p align="center">
  <b>English</b> · <a href="#فارسی">فارسی</a>
</p>

---

**Jagir** (جاگیر, *"place-finder"*) is a [Model Context Protocol](https://modelcontextprotocol.io) server that lets Claude and other AI assistants search **Jabama**, **Jajiga** and **Otaghak**, Iran's largest vacation-rental platforms, at the same time.

Ask in plain Persian or English. Jagir fans out to all three platforms, normalizes the results (Toman, Gregorian or Jalali dates, one schema), and gives your assistant everything it needs to compare: prices, availability, amenities, cleanliness scores and full guest reviews.

> «یه ویلا با ویو جنگل نزدیک رشت برای ۵ نفر، ۱۵ تا ۱۸ مهر، امتیاز بالای ۴.۵ و خیلی تمیز پیدا کن.»
>
> Claude searches all three sites, filters by cleanliness sub-rating, reads the reviews for complaints, quotes the exact total for 5 guests, and hands you a comparison table with booking links.

## Why Jagir

- **One search, three platforms.** Results are merged and sorted together (by price, rating or relevance). If one platform is down, the others still answer.
- **Built for Iran.** Prices in Toman (Jabama's Rial is converted), dates in Jalali (`1405-07-15`) or Gregorian (`2026-10-07`), Persian labels kept as-is.
- **Everything a listing has.** Amenities and what's *missing*, house rules, bed layout, area, privacy, view and setting, distance to the sea or city center, check-in times, cancellation policy, discounts and every photo.
- **Cleanliness and sub-ratings.** Each platform's rating breakdown (cleanliness, accuracy, host, location, value…) plus the star distribution.
- **Full guest reviews.** Complete review text, dates, host replies and, on Otaghak, the positives and negatives each guest listed.
- **Real prices.** Per-night calendars and quotes for your exact dates and number of guests, including extra-guest charges and service fees.
- **Read-only and private.** No login, no booking, no tracking. It never returns host phone numbers or names, and reviewer names are dropped.

## Quick start

### Claude Desktop: one-click extension (recommended)

1. Download **[`jagir.mcpb`](https://github.com/thejimbow/jagir-mcp/releases/latest/download/jagir.mcpb)** from the latest release.
2. Double-click it. Claude Desktop opens an install dialog; click **Install**.

No Node.js needed: Claude Desktop runs the extension with its built-in runtime.

### Claude Code

```bash
claude mcp add jagir -- npx -y jagir-mcp
```

### Other MCP clients (manual config)

Requires Node.js 20+.

```json
{
  "mcpServers": {
    "jagir": { "command": "npx", "args": ["-y", "jagir-mcp"] }
  }
}
```

Claude Desktop's config file lives at `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows). Restart the app after editing it.

## Tools

| Tool | What it does |
|---|---|
| `search_stays` | Search a city or region on all three platforms at once. Filters: dates, guests, price range, sort, platforms. Returns merged, normalized results. |
| `get_stay` | Everything about one listing: amenities and missing amenities, rules, rating breakdown (incl. cleanliness), beds, area, privacy, view and setting, distances, discounts, all photos. |
| `get_reviews` | Guest reviews with full text, rating, date, host reply and (Otaghak) positive and negative points. Up to 200 per call. |
| `get_stay_calendar` | Per-night availability and price for up to 120 days. |
| `get_quote` | Exact total for given dates and guests: nightly breakdown, extra-guest cost and fees. |
| `resolve_location` | How a place name is known on each platform (useful for villages and regions). |

Stay ids look like `jabama:800749`, `jajiga:3237270` or `otaghak:2397109`, and every result includes a direct link to the listing.

## Example prompts

- «ارزون‌ترین ویلاهای رامسر برای ۴ نفر از ۲۳ تا ۲۵ مهر رو از هر سه سایت مقایسه کن»
- «برای این اقامتگاه همه نظرات رو بخون و بگو کسی از تمیزی یا سروصدا شکایت کرده یا نه»
- «تقویم این ویلا رو برای آبان نشون بده؛ کدوم آخر هفته‌ها خالیه و چنده؟»
- "Find a beachfront stay in Kish for 2 guests next weekend under 3 million Toman a night, sorted by rating."
- "Compare the top 3 cabins near Masuleh by cleanliness score and total price for 3 nights."

## How it works

```
             ┌──────────── search_stays ────────────┐
Claude  ──►  │  Jagir (stdio, runs on your machine)  │
             └───────┬───────────┬───────────┬──────┘
                     ▼           ▼           ▼
                  Jabama      Jajiga      Otaghak
                (public web APIs the sites themselves use)
```

Each platform has an adapter that calls the same public JSON endpoints its website uses and maps the response to one shared schema. Requests run in parallel. Failures are isolated per platform and reported in an `errors` field instead of failing the whole search.

Notes on prices:
- With dates, `price.total` is the stay total for the requested guests, as each platform's search reports it.
- `get_quote` adds service fees where a platform charges them (Jajiga).
- Otaghak quotes are computed from its calendar and extra-guest price and are marked `estimated: true`.

These endpoints are undocumented and can change without notice. If something breaks, please [open an issue](https://github.com/thejimbow/jagir-mcp/issues).

## Privacy and scope

- Read-only: Jagir never logs in, books, messages hosts or calls any write endpoint.
- No host phone numbers, host names or host ids are ever returned. Reviewer names are dropped.
- Runs locally over stdio. Nothing is sent anywhere except the three platforms' public APIs.

## Development

```bash
git clone https://github.com/thejimbow/jagir-mcp.git
cd jagir-mcp
npm install
npm test             # unit tests against recorded fixtures
npm run test:live    # smoke test against the real platforms
npm run build        # compile to dist/
npm run pack:mcpb    # build the Claude Desktop extension (jagir.mcpb)
```

Project layout: `src/platforms/` holds one adapter per platform, `src/core/` holds dates, HTTP and the aggregator, and `src/server.ts` defines the MCP tools.

Contributions are welcome, especially adapters for more platforms (Shab, Homsa…) and fixes when a platform changes its API.

<br>

<div dir="rtl" align="right">

## فارسی

**جاگیر** یه سرور MCP هست که به Claude و بقیه‌ی دستیارهای هوش مصنوعی اجازه می‌ده هم‌زمان توی **جاباما**، **جاجیگا** و **اتاقک** دنبال اقامتگاه بگردن.

به فارسی بپرس. جاگیر هر سه سایت رو با هم می‌گرده، قیمت‌ها رو به تومان یکدست می‌کنه، تاریخ شمسی و میلادی رو می‌فهمه و همه‌ی اطلاعات لازم برای مقایسه رو به دستیار می‌ده: قیمت دقیق، تقویم خالی بودن، امکانات، امتیاز تمیزی و نظرات کامل مهمون‌ها.

### چه کارهایی می‌کنه

- **یه جستجو، سه سایت:** نتایج با هم ادغام و مرتب می‌شن. اگه یکی از سایت‌ها از دسترس خارج باشه، بقیه جواب می‌دن.
- **همه‌ی اطلاعات آگهی:** امکانات (و امکاناتی که نداره)، قوانین، چیدمان تخت‌ها، متراژ، دربست یا اشتراکی، ویو و بافت، فاصله تا دریا و مرکز شهر، تخفیف‌ها و همه‌ی عکس‌ها.
- **ریزامتیازها:** امتیاز تمیزی، صحت مطالب، برخورد میزبان، موقعیت و ارزش به قیمت، به‌علاوه‌ی توزیع ستاره‌ها.
- **نظرات کامل:** متن کامل، تاریخ، پاسخ میزبان و نکات مثبت و منفی (اتاقک).
- **قیمت واقعی:** تقویم شبانه و قیمت نهایی برای تاریخ و تعداد نفرات شما، با هزینه‌ی نفر اضافه و کارمزد.
- **فقط خواندنی:** نه لاگین می‌کنه، نه رزرو. شماره و اسم میزبان و اسم نظردهنده‌ها هیچ‌وقت برگردونده نمی‌شه.

### نصب

**Claude Desktop:** فایل **[`jagir.mcpb`](https://github.com/thejimbow/jagir-mcp/releases/latest/download/jagir.mcpb)** رو دانلود کن و روش دابل‌کلیک کن. نیازی به نصب Node نیست.

**Claude Code:**

</div>

```bash
claude mcp add jagir -- npx -y jagir-mcp
```

<div dir="rtl" align="right">

### یه نمونه پرامپت

</div>

```text
با جاگیر یه اقامتگاه در رشت یا اطراف نزدیکش پیدا کن.
ورود ۱۴۰۵/۰۷/۱۵، خروج ۱۴۰۵/۰۷/۱۸، ۵ نفر.
امتیاز ۴.۵ به بالا با حداقل ۱۰ نظر، امتیاز تمیزی ۴.۷ به بالا، ویو جنگل یا کوه.
نظرات ۵ گزینه‌ی برتر رو بخون و هر شکایتی از تمیزی یا سروصدا رو گزارش کن.
برای ۳ گزینه‌ی نهایی قیمت دقیق ۵ نفر رو بگیر و یه جدول مقایسه با لینک بده.
```

---

## Disclaimer

Jagir is an independent open-source project and is not affiliated with, endorsed by or sponsored by Jabama, Jajiga or Otaghak. All trademarks belong to their owners. Prices and availability come directly from the platforms and can change at any time; always confirm on the platform before booking.

## License

[MIT](LICENSE)
