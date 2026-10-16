/**
 * Copies the Draco decoder shipped with three.js into `public/draco/`, so the
 * Draco-compressed GLBs decode from our own origin instead of a CDN.
 */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const source = path.resolve('node_modules/three/examples/jsm/libs/draco/gltf');
const target = path.resolve('public/draco');
const files = ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js'];

if (!existsSync(source)) {
  console.error(`Draco decoder not found at ${source}; run npm install first.`);
  process.exit(1);
}
mkdirSync(target, { recursive: true });
for (const file of files) {
  copyFileSync(path.join(source, file), path.join(target, file));
}
console.log(`draco: ${files.length} decoder files → public/draco/`);
