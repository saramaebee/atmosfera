# atmosfera

Discord bot that renders climate comparisons and live weather imagery for cities. This file is the glossary of the project's ubiquitous language — canonical terms only, synonyms under _Avoid_.

## Climatology

**Climatology window**:
The last 15 complete years of history that a city's climate statistics are computed from.

**ClimateCube**:
The pre-aggregated per-city store of climatological statistics. All climate charts render from it, never from raw historical years.

## Radar

**Radar loop**:
The animated sequence of radar frames `/radar` returns, over a fixed viewport centered on one city.

**Frame**:
One timestamped radar image in the catalog. Frames are immutable and content-addressed; they age out of the catalog within about two hours.

**Catalog**:
RainViewer's live index of the frames that currently exist (past and nowcast). The sole entry point to radar imagery — frame addresses cannot be derived from timestamps.

**Past (radar mode)**:
The radar loop over the catalog's recent frames (roughly the last two hours).
_Avoid_: historical — reserved for climatology.

**Nowcast**:
Short-range forecast radar (roughly the next half hour), anchored on the newest past frame.
_Avoid_: predictive, forecast radar.

**Viewport**:
The fixed 512-pixel, zoom-7 Web-Mercator window centered on a city that every radar frame is rendered into. Deliberately not user-adjustable: radar detail tops out at zoom 7 upstream, so a tighter zoom would only magnify, not reveal.

**Basemap**:
The CARTO Positron map imagery drawn beneath the radar layer.
