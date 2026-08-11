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

## Slash-command hygiene

Every slash command in `apps/discord-bot/src/commands/` must declare all three:

1. **`requiredClientPermissions`** — the union of Discord permissions every discord.js call site in the command (and any helpers it calls) needs. Examples: `interaction.editReply({ files })` needs `AttachFiles`; `interaction.channel.send()` needs `SendMessages` (or `SendMessagesInThreads` in threads); `channel.messages.fetch()` needs `ViewChannel` + `ReadMessageHistory`. **Whenever you add, remove, or change a discord.js call site, re-derive this list and update it.** A regression test asserts the field is non-empty but cannot catch drift — that's on the author.

2. **`registerScope(name, { baseline, ownerOverride?, protected? })`** — registers the command's compiled-in user scope. `baseline: 'admin'` requires Manage Server; `baseline: 'everyone'` is open by default. `protected: true` makes the command immune to restrictive per-guild RBAC rules (users always retain access). `ownerOverride: true` lets users in `DISCORD_OWNER_IDS` bypass the user-scope check.

3. **`preconditions: ['AtmosferaScope']`** — runs the layered access check (owner override → RBAC rule → baseline) at invocation time. Required on every command.

Pipe every command's builder through `applyScopeToBuilder(builder, SCOPE)` inside `registerApplicationCommands`. It currently just enforces `setDMPermission(false)` for `admin`-baseline commands; we deliberately do **not** call `setDefaultMemberPermissions`, because Discord treats that as an invocation gate (would block non-admins regardless of bot-side RBAC grants). The `AtmosferaScope` precondition is the single source of truth for who can invoke.

## Audit logging

Any admin-facing mutation must call `recordAuditEvent({ guildId, actorId, eventType, subjectType, subjectId, metadata? })` from `@atmosfera/db`. Event-type convention: `domain.subject.action` (e.g. `permission.grant`, `permission.revoke`). Don't audit ordinary user activity. When the same mutation is reachable from both the bot and the web app, record the same event types on both surfaces and distinguish source via `metadata.via: 'slash' | 'web'`.
