# Discord Climate Comparison Bot — TS/SVG Architecture Spec

## Product Definition

A Discord bot that generates WeatherSpark-style climate visualizations comparing cities across the year.

Primary output:
- PNG climate charts
- visually dense, social-shareable comparisons
- minimal text

Primary use case:

```txt
/compare "Buenos Aires" "Columbia"
```

Bot returns:
- annual temperature heatmap comparison
- muggy-condition probability chart
- optional wet-day probability chart
- short caption

The product is fundamentally:

```txt
climate aggregation engine
+ SVG chart renderer
+ Discord delivery layer
```

—not a conversational weather assistant.

---

# Tech Stack

## Runtime + Language

```txt
Runtime:        Bun
Language:       TypeScript
Package mgr:    Bun
Validation:     zod
Lint/format:    Biome
Tests:          Vitest
```

---

## Discord Layer

```txt
Bot framework:  Sapphire
Discord SDK:    discord.js
```

Responsibilities:
- slash commands
- command routing
- interaction lifecycle
- attachment uploads
- guild preferences

Bot should remain thin.

Business logic belongs in packages.

---

## Data + ORM

```txt
DB:             SQLite first
ORM:            Drizzle
```

Upgrade path:

```txt
SQLite -> Postgres
```

SQLite is sufficient for:
- city metadata
- cache metadata
- guild preferences
- render manifests
- climatology metadata

Heavy climate arrays should live on disk, not in relational rows.

---

## Rendering Stack

```txt
Rendering:      SVG -> PNG
Renderer libs:  D3 + Satori + Resvg
```

Roles:

### D3

Use for:
- scales
- paths
- axes
- interpolation
- smoothing helpers

### Satori

Use for:
- JSX-driven layouts
- typography
- legends
- labels
- card composition

### Resvg

Use for:
- deterministic SVG rasterization
- Discord-ready PNG generation

Avoid canvas-first rendering.

These charts are fundamentally:
- vector layouts
- typography
- gradients
- overlays
- smoothed paths

SVG-first is the correct architecture.

---

## HTTP Layer

```txt
HTTP server: Hono
```

Optional in v0.

Useful later for:
- health checks
- render previews
- public API
- CDN-style chart serving
- metrics

Do not overbuild this initially.

---

## Jobs + Queueing

Initial:

```txt
Jobs: Bun scripts
```

Later only if necessary:

```txt
BullMQ + Redis
```

Most climate computation is:
- deterministic
- cacheable
- infrequent

You likely do not need a real queue in v0.

---

## Deployment

```txt
Docker
Fly.io / Railway / VPS
```

Single-container deployment initially.

Later split:

```txt
bot
renderer
worker
```

only if scaling becomes necessary.

---

# Monorepo Structure

```txt
/apps
  /discord-bot
  /api
  /worker

/packages
  /climate
  /charts
  /db
  /geocode
  /config
```

---

# Package Responsibilities

## /packages/climate

Responsible for:
- Open-Meteo historical fetches
- climatology aggregation
- smoothing
- muggy calculations
- wet-day calculations
- ClimateCube generation

Exports:

```ts
buildClimateCube()
loadClimateCube()
computeMuggyProbability()
computeWetDayProbability()
```

---

## /packages/charts

Pure rendering layer.

No Discord logic.

Exports:

```ts
renderTemperatureComparisonSvg()
renderMuggyComparisonSvg()
renderWetDayComparisonSvg()
svgToPng()
```

Input:
- typed chart DTOs
- ClimateCube slices

Output:
- SVG string
- PNG buffer

---

## /packages/db

Contains:
- Drizzle schema
- migrations
- repositories
- cache metadata

---

## /packages/geocode

Responsible for:
- Open-Meteo geocoding
- fallback providers
- canonicalization
- timezone resolution

---

## /packages/config

Contains:
- environment parsing
- zod validation
- runtime flags

---

# Climate Data Architecture

## Key Design Principle

DO NOT render directly from raw historical years.

Instead:

```txt
raw historical data
    ↓
climatology aggregation
    ↓
ClimateCube cache
    ↓
chart rendering
```

This is the core optimization.

---

# ClimateCube Format

Internal representation:

```ts
interface ClimateCube {
  timezone: string

  temperatureMean: number[][]
  temperatureP10: number[][]
  temperatureP90: number[][]

  dewpointMean: number[][]

  muggyProbability: number[]

  wetDayProbability: number[]

  cloudcoverMean: number[][]
}
```

Dimensions:

```txt
[365][24]
```

for hourly climatology.

This makes rendering extremely fast.

---

# Historical Window

Use:

```txt
last 15 complete years
```

Example:

```txt
2011–2025
```

Reasons:
- modern climate representation
- manageable fetch sizes
- stable climatology

---

# Data Sources

## Geocoding

Primary:

```txt
Open-Meteo Geocoding API
```

Fallback:

```txt
Nominatim
```

Store:
- canonical city name
- region
- country
- lat/lon
- timezone

---

## Historical Weather

Primary:

```txt
Open-Meteo Historical API
```

Request hourly:

```txt
temperature_2m
dewpoint_2m
precipitation
cloudcover
```

Always:

```txt
timezone=auto
```

Local-time aggregation is critical.

---

# Visualization Types

## 1. Temperature Heatmap

WeatherSpark-inspired.

Axes:
- X = day of year
- Y = local hour

Cell value:
- average temperature

Rendered as:
- perceptual comfort bands
- smoothed regions

Includes:
- twilight overlays
- labels
- shared legend

---

# Temperature Bands

```ts
const BANDS_C = [
  [-100, -9, 'frigid'],
  [-9, 0, 'freezing'],
  [0, 7, 'very cold'],
  [7, 13, 'cold'],
  [13, 18, 'cool'],
  [18, 24, 'comfortable'],
  [24, 29, 'warm'],
  [29, 35, 'hot'],
  [35, 100, 'sweltering'],
]
```

Discrete semantic bands are more readable than continuous heatmaps.

---

## 2. Muggy Probability Chart

Definition:

```txt
dew point >= 18°C
```

For each day-of-year:

```txt
fraction of hours classified as muggy
```

Output:
- smooth overlapping curves
- direct labels
- peak annotations

---

## 3. Wet-Day Probability Chart

Definition:

```txt
Probability of >= 1 mm precipitation
```

Optional in v0 if time constrained.

---

# Smoothing

Critical requirement.

Raw climatology is ugly.

Apply:
- rolling windows
- Gaussian smoothing
- Savitzky-Golay filtering

Suggested:

```txt
7–15 day smoothing windows
```

depending on chart type.

---

# Twilight Overlay

Required for temperature heatmaps.

Compute:
- sunrise
- sunset
- civil twilight

Use:

```txt
astral
```

or equivalent.

Overlay semi-transparent shading.

This dramatically improves readability.

---

# Discord Commands

## Compare

```txt
/compare city_a city_b
```

Returns:
- temperature comparison
- muggy comparison
- optional wet-day chart

---

## Muggy

```txt
/muggy city
```

Returns:
- muggy probability chart

---

## Climate

```txt
/climate city
```

Returns:
- single-city climate card

---

# City Disambiguation

City names are not unique. The bot must treat geocoding as a candidate-selection problem, not a simple lookup.

Examples:
- Columbia, South Carolina, United States
- Columbia, Missouri, United States
- Columbia, Maryland, United States
- Columbia, Tennessee, United States
- Colombia, the country, if the user misspells or omits context

The geocoder should return multiple candidates when confidence is not high enough.

Disambiguation prompt:

```txt
Which Columbia did you mean?

1. Columbia, South Carolina, United States
2. Columbia, Missouri, United States
3. Columbia, Maryland, United States
4. Columbia, Tennessee, United States
```

Use Discord select menus or buttons.

Selection should be required when:
- multiple candidates have similar names
- the top result has weak confidence
- the query is a bare city name with several plausible matches
- the query may be a country/region typo, e.g. `columbia` vs `colombia`

Selection should be skipped when:
- the user provides enough context, e.g. `Columbia SC`
- the result is overwhelmingly dominant
- the query includes country/region, e.g. `Paris, France`

Store successful selections as aliases so repeated commands resolve cleanly.

Alias examples:

```txt
columbia sc -> Columbia, South Carolina, United States
columbia missouri -> Columbia, Missouri, United States
nyc -> New York, New York, United States
```

Alias scope:
- global aliases for obvious common names
- guild-level aliases for server-specific preferences
- optional user-level recent selections

Do not silently pick a city when ambiguity materially affects the chart.

---

# Caching Strategy

## Filesystem Cache

```txt
.cache/
  raw/open-meteo/
  cubes/
  charts/
```

---

## Raw Weather Cache

Keyed by:

```txt
location + year
```

---

## ClimateCube Cache

Keyed by:

```txt
location + climatology window + smoothing version
```

---

## Chart Cache

Optional.

Useful for:
- repeat comparisons
- expensive rasterization

---

# Performance Goals

## Cached Render

```txt
<1 second
```

---

## First-Time City Build

```txt
5–20 seconds
```

Acceptable because:
- computation is one-time
- results become permanently cached

---

# Recommended Development Order

## Phase 1

- geocoding
- Open-Meteo fetches
- SQLite setup
- ClimateCube builder
- muggy chart renderer

---

## Phase 2

- temperature heatmap renderer
- smoothing
- palettes
- SVG rasterization

---

## Phase 3

- twilight overlays
- typography polish
- annotations
- better layouts

---

## Phase 4

- wet-day charts
- roast captions
- chart caching
- API routes

---

# Biggest Risks

## 1. Ugly Charts

Most likely failure mode.

The hard problem is:
- smoothing
- palette tuning
- typography
- label density

—not climate math.

---

## 2. Overengineering

Avoid:
- Redis
- queues
- microservices
- Kubernetes
- Next.js
- Prisma

until genuinely needed.

---

## 3. Bun Compatibility

Some Node ecosystem packages still behave inconsistently under Bun.

Prefer:
- pure TS libraries
- SVG-first tooling
- minimal native dependencies

Avoid fragile canvas bindings early.

---

# Long-Term Extensions

Potential later additions:

- sunshine probability
- cloudiness
- beach score
- skiing score
- climate similarity search
- "find cities like X but drier"
- animated seasonal transitions
- web preview frontend

