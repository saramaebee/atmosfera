import { Resvg } from '@resvg/resvg-js';

export function svgToPng(svg: string, width?: number): Buffer {
  const resvg = new Resvg(svg, width ? { fitTo: { mode: 'width', value: width } } : {});
  return resvg.render().asPng();
}
