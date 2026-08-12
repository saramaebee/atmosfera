import { Resvg } from '@resvg/resvg-js';

export function svgToPng(svg: string, width?: number): Buffer {
  const resvg = new Resvg(svg, width ? { fitTo: { mode: 'width', value: width } } : {});
  return resvg.render().asPng();
}

/** Rasterize to raw RGBA pixels (for animation encoders like gifenc). */
export function svgToRgba(svg: string): { pixels: Buffer; width: number; height: number } {
  const rendered = new Resvg(svg).render();
  return { pixels: rendered.pixels, width: rendered.width, height: rendered.height };
}
