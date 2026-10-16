/**
 * Generates the Fanation mark from the same golden-angle spiral the city is
 * built on: the white genesis plot at (0,0), fans spiralling out from it.
 *
 *   node scripts/generate-brand.mjs  →  public/brand/*.svg, public/favicon.svg
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const GOLDEN_ANGLE = (137.50776405003785 * Math.PI) / 180;
const ACCENT = '#2997FF';
const GENESIS = '#FFFFFF';
const TILE = '#0B0B0F';

function round(value) {
  return Math.round(value * 100) / 100;
}

/** Dots shrink and fade outward so the centre reads first at favicon size. */
function spiralDots({ count, cx, cy, spacing, offset, maxDot, minDot }) {
  const dots = [];
  for (let n = 1; n <= count; n += 1) {
    const radius = offset + spacing * Math.sqrt(n);
    const angle = n * GOLDEN_ANGLE;
    const t = n / count;
    dots.push(
      `<circle cx="${round(cx + radius * Math.cos(angle))}" cy="${round(cy + radius * Math.sin(angle))}" ` +
        `r="${round(maxDot - (maxDot - minDot) * t)}" fill="${ACCENT}" fill-opacity="${round(1 - 0.72 * t)}"/>`
    );
  }
  return dots.join('');
}

function markSvg({ size, count, spacing, offset, maxDot, minDot, genesis, cornerRadius }) {
  const c = size / 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Fanation">` +
    `<rect width="${size}" height="${size}" rx="${cornerRadius}" fill="${TILE}"/>` +
    spiralDots({ count, cx: c, cy: c, spacing, offset, maxDot, minDot }) +
    `<circle cx="${c}" cy="${c}" r="${genesis}" fill="${GENESIS}"/>` +
    `</svg>\n`
  );
}

const outDir = path.resolve('public/brand');
mkdirSync(outDir, { recursive: true });

const mark = markSvg({ size: 512, count: 89, spacing: 19, offset: 22, maxDot: 14, minDot: 6, genesis: 24, cornerRadius: 114 });
const favicon = markSvg({ size: 64, count: 21, spacing: 4.8, offset: 5, maxDot: 3.2, minDot: 2, genesis: 5.5, cornerRadius: 14 });

writeFileSync(path.join(outDir, 'fanation-mark.svg'), mark);
writeFileSync(path.resolve('public/favicon.svg'), favicon);
console.log('brand: public/brand/fanation-mark.svg, public/favicon.svg');
