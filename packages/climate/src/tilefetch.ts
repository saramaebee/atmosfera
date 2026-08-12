/**
 * One tile-fetch attempt, shared by basemap.ts and rainviewer.ts. Each attempt
 * gets its own 10 s timeout; a caller-supplied signal imposes an overall
 * deadline across attempts.
 */
export async function fetchTileBuffer(url: string, signal?: AbortSignal): Promise<Buffer> {
  const timeout = AbortSignal.timeout(10_000);
  const res = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!res.ok) throw new Error(`Tile fetch failed: ${res.status} ${res.statusText} (${url})`);
  return Buffer.from(await res.arrayBuffer());
}
