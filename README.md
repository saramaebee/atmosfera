# atmosfera

A Discord bot for climate charts and live weather: 15 years of hourly weather data turned into climatology charts for any city — temperature heatmaps, muggy probability, wet-day probability, two-city comparisons — plus current conditions (`/now`) and animated precipitation radar (`/radar`). Privacy disclosure (`/privacy`) and per-guild RBAC (`/permissions`) live alongside it.

Climate data is sourced from [Open-Meteo](https://open-meteo.com) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Radar imagery © [RainViewer](https://www.rainviewer.com); basemap © OpenStreetMap contributors © [CARTO](https://carto.com).

![Buenos Aires vs Reykjavík temperature climatology](docs/examples/heatmap-buenos-aires-vs-reykjavik.png)

Top panel: Buenos Aires' diurnal cycle through the year — hot orange summer afternoons in January, cool cyan winter dawns in July. Bottom: Reykjavík maxes out at the green "cool" band, and the dark stripe at the top contracts almost to nothing in mid-June (polar-day effect). Twilight overlay marks hours when the sun is below the horizon.

![Tokyo vs Buenos Aires muggy probability](docs/examples/muggy-tokyo-vs-buenos-aires.png)

The muggy-probability comparison: Tokyo's monsoon season hits 100% in early August (`tsuyu`), while Buenos Aires is the inverse-hemisphere mirror image with its peak in late January. Peak markers annotate the day and percentage automatically.

---

## Slash commands

**Climate:**

| Command | What it does |
| --- | --- |
| `/climate <city>` | Temperature heatmap |
| `/muggy <city>` | Muggy probability (dew point ≥ 18°C) |
| `/wet <city>` | Wet-day probability (≥ 1 mm of rain) |
| `/compare <city_a> <city_b> [chart]` | Both cities side-by-side. `chart` choices: `heatmap`, `muggy`, `wetday`, `all` |

Every graphics command (climate + live weather) also takes an optional `theme` choice: `dark` (default) or `light`.

**Live weather:**

| Command | What it does |
| --- | --- |
| `/now <city>` | Current weather and the next 24 hours as an hourly card |
| `/radar <city> [mode]` | Animated precipitation radar GIF. Modes: `Past 2 hours` (default) or `Nowcast` — nowcast frames aren't currently published on RainViewer's free tier, so that mode answers with a graceful error until upstream restores them. 30 s per-user cooldown |

**Utilities & server tools:**

| Command | What it does |
| --- | --- |
| `/checklang <text>` | Classify text as English, Spanish, mixed, other, or unknown |
| `/privacy` | View what's stored and what's sent to third parties |
| `/permissions` | Per-guild RBAC: grant/revoke command access for users or roles (admin) |
| `/sync` | Force re-push slash-command registrations to Discord (bot owner) |

**Disambiguation**: when a city name is ambiguous (e.g. "Columbia" — there are four in the US alone), the bot replies with an ephemeral dropdown so only the invoker sees the picker. A "save as alias" toggle persists the pick so the next time that user types the same query, it resolves instantly.

---

## Quickstart (self-host)

Requires [Bun](https://bun.sh) 1.3+ and a Discord application.

```bash
git clone https://github.com/saramaebee/atmosfera.git
cd atmosfera
bun install
cp .env.example .env
# Fill in DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_DEV_GUILD_ID
bun apps/discord-bot/src/index.ts
```

Slash commands register guild-scoped to `DISCORD_DEV_GUILD_ID` so they appear instantly in your dev server. Drop that env var and they'll register globally (1-hour propagation lag).

You can also iterate on charts without Discord:

```bash
bun run render "Tokyo" "Reykjavik" --chart heatmap --out out/tk-vs-rk.png
bun run render "Buenos Aires" --chart muggy
```

---

## Architecture

Bun + TypeScript monorepo. Bot is intentionally thin — the substance is in the packages.

```
apps/discord-bot/        Sapphire-framework Discord bot. Slash routing only.
packages/
  config/                zod-validated env + sqlite URL helper
  geocode/               Open-Meteo geocoder + qualifier parsing + dominance heuristics
  climate/               Weather-data acquisition: historical fetch + climatology aggregation +
                         Gaussian smoothing + live imagery (RainViewer radar, CARTO basemap, tile math)
  charts/                Image production: D3 + Resvg renderers (muggy, wet-day, temperature heatmap,
                         now card) + twilight overlay + radar GIF frames (gifenc)
  db/                    Drizzle ORM over bun:sqlite (cities, aliases) + migrations
scripts/
  render.ts              CLI driver — same renderers, no Discord roundtrip
  radar-smoke.ts         End-to-end radar GIF against live RainViewer + CARTO
  smoke/                 Resvg quality gate
```

### Data flow

```
Open-Meteo geocode → cities table
Open-Meteo historical → .cache/raw/open-meteo/<lat>_<lon>/<year>.json
       ↓
climatology aggregation (15 years, 2011–2025) + Gaussian smoothing
       ↓
ClimateCube → .cache/cubes/<lat>_<lon>/cube-<version>.json
       ↓
chart renderers (SVG) + Resvg rasterizer
       ↓
.cache/charts/<sha1>.png → Discord attachment
```

- **Raw cache** is per `(location, year)` — one fetch per year per city, ever.
- **Cube cache** keys on `(location, cube version)`. Bumping `CUBE_VERSION` in `packages/climate/src/types.ts` automatically invalidates downstream charts.
- **Chart cache** keys on `(kind, lat, lon, cube version)`. Repeat commands skip Resvg entirely.

Radar is live imagery and bypasses the cube pipeline entirely:

```
RainViewer catalog (3 min TTL) → radar frame tiles (z7)  ┐
CARTO Positron basemap tiles → .cache/tiles/ (immutable) ├→ SVG per frame → Resvg → gifenc GIF → Discord attachment
```

Completed GIFs are deliberately not cached — a GIF must never outlive the catalog that produced it. Concurrent requests for the same city coalesce into one build. A frame missing any radar tile is dropped rather than rendered as falsely dry ground (honest frames only).

### Why these choices

- **Bun** over Node — `bun:sqlite` (no native bindings, faster than `better-sqlite3`), faster startup, `.env` loading built in, Vitest-compatible `bun:test`. Phase 0 smoke-tested Resvg under Bun before committing the stack.
- **Open-Meteo** as the only weather provider — free, no key, well-documented, generous rate limits, returns local-time hourly data via `timezone=auto`.
- **SVG-first rendering** with D3 + Resvg — fast deterministic rasterization, no headless browser, no canvas native deps. Heatmap is ~17,000 SVG rects; rasterizes in ~500 ms.
- **Filesystem caches over a database** — climatology data is large and write-once; SQLite is for queryable state (cities, aliases). Mixing the two would make the schema noisy without performance benefit.
- **Radar imagery stack** — RainViewer + CARTO Positron + GIF via gifenc, chosen as a unit. Why zoom is pinned at 7, why the attribution bar in every frame must stay, and why GIF beat WebP/MP4: see [docs/adr/0001-radar-imagery-stack.md](docs/adr/0001-radar-imagery-stack.md).

Recorded decisions live in [`docs/adr/`](docs/adr/); the project's domain vocabulary lives in [`CONTEXT.md`](CONTEXT.md).

---

## Development

```bash
bun test                                   # 274 tests across 35 files
bun x tsc --noEmit -p tsconfig.json        # full repo typecheck
bun x biome check .                        # lint + format check
bun x biome format --write .               # autofix formatting
bun run render <city> [<city>] --chart <muggy|wetday|heatmap|now> [--theme light|dark]   # CLI
bun run radar <city> [--theme light|dark] [--out path.gif]  # radar GIF end-to-end, no Discord
```

Slash commands and library code live side by side; the CLI hits the same functions the bot does, so feature work can be iterated visually before being wired into Discord.

### Adding a new chart type

1. New file in `packages/charts/src/`. Add the renderer to `index.ts`.
2. Extend `ChartKind` in `packages/charts/src/cache.ts` so it gets PNG caching.
3. Wire into `apps/discord-bot/src/lib/charts.ts` (`buildRenderedMessage`).
4. Either: new `/commands/foo.ts` (single-purpose) or extend `/compare`'s `chart` choices.

### Bumping cube semantics

If you change smoothing, aggregation, or the cube schema:

1. Bump `CUBE_VERSION` in `packages/climate/src/types.ts`.
2. Cube files at `.cache/cubes/*/cube-<old>.json` become dead weight (safe to delete).
3. Chart cache invalidates automatically (cube version is part of its key).

---

## License & attribution

Code is [Apache 2.0](LICENSE).

Climate data — historical hourly archive and geocoding — comes from [Open-Meteo](https://open-meteo.com) under [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/). The data is reused with modification: hourly observations are aggregated into 15-year climatologies, smoothed, and converted into chart imagery. Every chart message in Discord credits Open-Meteo in its footer.

Radar imagery comes from [RainViewer](https://www.rainviewer.com)'s free public API. Basemap tiles are [CARTO](https://carto.com) Positron (light theme) / Dark Matter (dark theme), © OpenStreetMap contributors © CARTO, free for non-commercial use **conditional on attribution** — which is why every radar frame carries the credit line in its bottom bar, and every radar message repeats it. Do not remove either while these providers are in use (see [ADR 0001](docs/adr/0001-radar-imagery-stack.md)).
