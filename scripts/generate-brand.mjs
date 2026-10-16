/**
 * The Creator's anonymous avatar and pixel sunglasses, rebuilt in the existing
 * vector brand system. One source keeps the header, legacy path and favicon aligned.
 * Run: node scripts/generate-brand.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function markSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512" role="img" aria-label="naoeumfa.com">
  <defs><clipPath id="badge"><circle cx="256" cy="256" r="256"/></clipPath></defs>
  <g clip-path="url(#badge)">
    <circle cx="256" cy="256" r="256" fill="#45494E"/>
    <circle cx="256" cy="234" r="92" fill="#E4E8E7"/>
    <path d="M76 512C88 408 162 356 256 356s168 52 180 156Z" fill="#E4E8E7"/>
    <path d="M144 208h224v16h-8v16h-8v16h-72v-8h-8v-24h-24v24h-8v8h-72v-16h-8v-16h-8v-16Z" fill="#08090B"/>
    <path d="M160 216h8v8h-8zm16 0h8v8h-8zm-8 8h8v8h-8zm16 0h8v8h-8zm-8 8h8v8h-8zm16 0h8v8h-8zm8 8h8v8h-8zM280 216h8v8h-8zm16 0h8v8h-8zm-8 8h8v8h-8zm16 0h8v8h-8zm-8 8h8v8h-8zm16 0h8v8h-8zm8 8h8v8h-8z" fill="#FFFFFF"/>
  </g>
</svg>
`;
}
const outDir = path.resolve('public/brand');
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'naoeumfa-mark.svg'), markSvg(512));
writeFileSync(path.join(outDir, 'fanation-mark.svg'), markSvg(512));
writeFileSync(path.resolve('public/favicon.svg'), markSvg(64));
console.log('brand: avatar mark, legacy alias and favicon generated');
