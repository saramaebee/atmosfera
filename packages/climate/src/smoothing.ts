/**
 * Gaussian and circular-rolling smoothing for annual climatologies.
 *
 * Climate signals wrap (Dec 31 is adjacent to Jan 1), so all kernels are applied circularly.
 */

/**
 * Discrete 1-D Gaussian kernel with radius ceil(3σ) and weights summing to 1.
 *
 * sigma=2.5 → ~15-day effective window (matches spec's upper bound).
 * sigma=3   → ~19-day window.
 */
export function gaussianKernel1d(sigma: number): number[] {
  if (sigma <= 0) throw new Error(`gaussianKernel1d: sigma must be > 0 (got ${sigma})`);
  const radius = Math.ceil(sigma * 3);
  const raw: number[] = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    raw.push(v);
    sum += v;
  }
  return raw.map((v) => v / sum);
}

/**
 * Apply a symmetric kernel to a 1-D series with circular (wrap-around) boundary.
 * Kernel length must be odd. NaN inputs are treated as zero AND contribute zero
 * to the normalizer so the kernel re-weights over the finite samples.
 */
export function circularSmooth1d(values: number[], kernel: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (kernel.length % 2 === 0) {
    throw new Error(`circularSmooth1d: kernel length must be odd (got ${kernel.length})`);
  }
  const radius = (kernel.length - 1) / 2;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    let weight = 0;
    for (let k = -radius; k <= radius; k++) {
      const idx = (((i + k) % n) + n) % n;
      const v = values[idx]!;
      const w = kernel[k + radius]!;
      if (Number.isFinite(v)) {
        acc += v * w;
        weight += w;
      }
    }
    out[i] = weight > 0 ? acc / weight : Number.NaN;
  }
  return out;
}

/** Gaussian smoothing in one call. */
export function gaussianSmooth1d(values: number[], sigma: number): number[] {
  return circularSmooth1d(values, gaussianKernel1d(sigma));
}

/** Smoothing parameters baked into a cube. Bumping these requires a CUBE_VERSION bump. */
export const MUGGY_SIGMA_DAYS = 3;
export const WETDAY_SIGMA_DAYS = 4;
