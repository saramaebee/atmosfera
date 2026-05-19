# atmosfera

Discord bot that generates WeatherSpark-style climate comparison charts for cities. Full spec lives in `discord_climate_bot_updated_spec.md` — read it before substantive work; this file is the always-loaded TL;DR.

## Stack (locked)

- Runtime: Bun
- Language: TypeScript
- Discord: Sapphire + discord.js
- DB: SQLite + Drizzle (Postgres later if needed)
- Rendering: SVG-first — D3 (geometry) + Satori (JSX layout) + Resvg (raster)
- Validation: zod
- Lint/format: Biome
- Tests: `bun:test` (Vitest-compatible API — switched from Vitest at Phase 0 so `bun:sqlite` works in tests without running Vitest under Bun)
- HTTP (optional, v0+): Hono
- Data: Open-Meteo (historical + geocoding), Nominatim fallback

## Non-negotiables

- **SVG-first rendering.** No canvas-based chart libs. These outputs are vector layouts, typography, gradients, and smoothed paths — SVG territory.
- **Render from ClimateCube cache, never from raw historical years.** Aggregation → cube → render is the core perf optimization.
- **Local-time aggregation.** All Open-Meteo requests use `timezone=auto`; hourly aggregation runs against local hours.
- **Climatology window: last 15 complete years.**
- **City disambiguation is candidate-selection, not lookup.** Never silently pick when ambiguity materially affects the chart. Store successful selections as aliases (global / guild / user scope).
- **No premature infra.** Avoid Redis, BullMQ, microservices, Kubernetes, Next.js, Prisma until genuinely needed. Bun scripts are the v0 job runner.
- **Keep the bot thin.** Slash-command routing only. Business logic lives in `packages/`.

## Planned layout (not scaffolded yet)

```
apps/{discord-bot,api,worker}
packages/{climate,charts,db,geocode,config}
```

Don't scaffold until we explicitly walk through it.

## Working agreement

- Ask before non-trivial edits.
- Don't commit unless asked. Don't push.
- Prefer pure-TS libs; avoid fragile native/canvas bindings (Bun compat risk).
