/**
 * Não É Um Fã mark: golden-angle spiral city DNA + meme shield
 * (UFO saucer that reads as a chupeta / pacifier).
 *
 *   node scripts/generate-brand.mjs  →  public/brand/*.svg, public/favicon.svg
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const GOLDEN_ANGLE = (137.50776405003785 * Math.PI) / 180;
const ACCENT = '#2997FF';
const ACCENT_SOFT = '#64D2FF';
const GENESIS = '#FFFFFF';
const TILE = '#0B0B0F';
const SAUCER = '#1C1C22';
const DOME = '#E8F4FF';

function round(value) {
  return Math.round(value * 100) / 100;
}

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

/** Pacifier-UFO: dome nipple + saucer disc + soft landing lights. */
function ufoMark(cx, cy, scale) {
  const s = scale;
  const domeR = 11 * s;
  const discRx = 28 * s;
  const discRy = 8 * s;
  const rimY = cy + 2 * s;
  return (
    `<ellipse cx="${round(cx)}" cy="${round(rimY)}" rx="${round(discRx)}" ry="${round(discRy)}" fill="${SAUCER}"/>` +
    `<ellipse cx="${round(cx)}" cy="${round(rimY)}" rx="${round(discRx)}" ry="${round(discRy)}" fill="none" stroke="${ACCENT}" stroke-width="${round(2.2 * s)}"/>` +
    `<path d="M ${round(cx - domeR * 0.95)} ${round(rimY - 1 * s)} A ${round(domeR)} ${round(domeR * 1.05)} 0 0 1 ${round(cx + domeR * 0.95)} ${round(rimY - 1 * s)} Z" fill="${DOME}"/>` +
    `<circle cx="${round(cx)}" cy="${round(rimY - domeR * 0.55)}" r="${round(3.2 * s)}" fill="${ACCENT_SOFT}" fill-opacity="0.85"/>` +
    `<circle cx="${round(cx - 16 * s)}" cy="${round(rimY + 1 * s)}" r="${round(1.8 * s)}" fill="${ACCENT}"/>` +
    `<circle cx="${round(cx)}" cy="${round(rimY + 2.5 * s)}" r="${round(1.8 * s)}" fill="${GENESIS}"/>` +
    `<circle cx="${round(cx + 16 * s)}" cy="${round(rimY + 1 * s)}" r="${round(1.8 * s)}" fill="${ACCENT}"/>`
  );
}

function markSvg({ size, count, spacing, offset, maxDot, minDot, cornerRadius, ufoScale }) {
  const c = size / 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Não É Um Fã">` +
    `<rect width="${size}" height="${size}" rx="${cornerRadius}" fill="${TILE}"/>` +
    spiralDots({ count, cx: c, cy: c, spacing, offset, maxDot, minDot }) +
    ufoMark(c, c - size * 0.02, ufoScale) +
    `</svg>\n`
  );
}

const outDir = path.resolve('public/brand');
mkdirSync(outDir, { recursive: true });

const mark = markSvg({
  size: 512,
  count: 72,
  spacing: 20,
  offset: 48,
  maxDot: 12,
  minDot: 5,
  cornerRadius: 114,
  ufoScale: 5.2,
});
const favicon = markSvg({
  size: 64,
  count: 16,
  spacing: 5.2,
  offset: 10,
  maxDot: 2.6,
  minDot: 1.6,
  cornerRadius: 14,
  ufoScale: 0.72,
});

writeFileSync(path.join(outDir, 'naoeumfa-mark.svg'), mark);
writeFileSync(path.join(outDir, 'fanation-mark.svg'), mark); // legacy path until all refs migrate
writeFileSync(path.resolve('public/favicon.svg'), favicon);
console.log('brand: public/brand/naoeumfa-mark.svg (+ legacy fanation-mark.svg), public/favicon.svg');
