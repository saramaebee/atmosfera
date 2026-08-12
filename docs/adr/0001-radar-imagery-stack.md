# Radar imagery stack: RainViewer + CARTO Positron + GIF via gifenc

`/radar` needs live precipitation tiles, a basemap under them, and an animated output Discord will play inline. We chose RainViewer for radar (keyless free tier, frames indexed by a live catalog of content-hashed paths), CARTO Positron for the basemap, and animated GIF encoded with gifenc — chosen as a unit, since each constrains the others.

## Consequences

- **Zoom is pinned at 7.** RainViewer's free tiles top out at z≤7, so a user-facing zoom option would magnify without revealing detail; the fixed 512 px viewport is deliberate.
- **The attribution bar is a license obligation, not decoration.** CARTO's free tier requires attribution (as does OpenStreetMap; RainViewer requests it). The credit line rendered into every frame's bottom bar must not be removed while these providers are in use.
- **Nowcast depends on upstream goodwill.** RainViewer's free API sometimes publishes no nowcast frames. The mode stays user-visible with a graceful ephemeral error because availability is checked against the live catalog — it self-heals with zero deploys if frames return.
- **256-color output.** GIF's palette limit is the price of inline autoplay in Discord; WebP/APNG/MP4 render better but need a click. gifenc is pure TS, honoring the repo's no-native-bindings rule.
