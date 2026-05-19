import { mkdirSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="160">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0ea5e9"/>
      <stop offset="100%" stop-color="#7c3aed"/>
    </linearGradient>
  </defs>
  <rect width="400" height="160" fill="url(#g)"/>
  <text x="200" y="92" font-family="sans-serif" font-size="36" font-weight="bold"
        fill="white" text-anchor="middle">atmosfera</text>
</svg>`;

const resvg = new Resvg(svg);
const png = resvg.render().asPng();

mkdirSync('out', { recursive: true });
writeFileSync('out/resvg-smoke.png', png);

console.log(`OK — wrote out/resvg-smoke.png (${png.length} bytes)`);
