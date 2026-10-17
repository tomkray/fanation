/**
 * Growth preview: grows a city with the real ledger rules from a seeded,
 * reproducible stream of comments (big idols, fans who become idols, unknown
 * idols named before they ever comment) and reports, at each stage, how far
 * fans live from their idol, whether lots overlap, and how long each
 * placement took. Writes a top-down map per stage to data/previews/.
 *
 *   npm run growth:preview -- --comments 60000
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { deflateSync, crc32 } from 'node:zlib';
import { applyCommentEvent, CityState, createCityState, DEFAULT_LEDGER_CONFIG, fansOf } from '../src/core/cityLedger.js';
import { settleLayout } from '../src/core/settle.js';
import { CITY_SITES, CityId } from '../src/core/cities.js';
import { BLOCK_PITCH_METERS, GENESIS_RADIUS_LOTS, cellToMeters, LOT_SIZE_METERS, territoryOf } from '../src/core/cityLayout.js';
import { resolveFandomMetadata } from '../src/core/fandomRegistry.js';
import { LandPlot } from '../src/core/types.js';

const BIG_IDOLS: readonly (readonly [string, number])[] = [
  ['bts.bighitofficial', 0.2],
  ['taylorswift', 0.12],
  ['realmadrid', 0.1],
  ['cristiano', 0.08],
  ['mrbeast', 0.07],
  ['badbunnypr', 0.06],
  ['blackpinkofficial', 0.05],
  ['leomessi', 0.05],
  ['beyonce', 0.04],
  ['fcbarcelona', 0.04],
  ['khaby00', 0.03],
  ['manchesterunited', 0.03],
];
/** The rest of the comments name a fan who became an idol, or someone unknown. */
const FAN_OF_FAN_SHARE = 0.1;
const RISING_STAR_POOL = 800;
const UNKNOWN_IDOL_POOL = 300;

function parseFlag(name: string, fallback: string, min: number, max: number): number {
  const flag = process.argv.indexOf(name);
  const raw = flag >= 0 ? process.argv[flag + 1] : fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max} (got ${String(raw)})`);
  }
  return n;
}

/** Comments arrive 50 ms apart, so an epoch of N comments is N × 50 ms of comment time. */
const COMMENT_SPACING_MS = 50;

/** mulberry32: small, fast and reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function zipfIndex(random: () => number, size: number): number {
  // Inverse-CDF approximation of a Zipf(1) draw over [0, size).
  return Math.min(size - 1, Math.floor(Math.exp(random() * Math.log(size + 1)) - 1));
}

function pickBigIdol(random: () => number): string {
  const total = BIG_IDOLS.reduce((sum, [, w]) => sum + w, 0);
  let roll = random() * total;
  for (const [handle, weight] of BIG_IDOLS) {
    roll -= weight;
    if (roll <= 0) {
      return handle;
    }
  }
  return BIG_IDOLS[0][0];
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

function metersBetween(a: LandPlot, b: LandPlot): number {
  const pa = cellToMeters(a.coordinates.gridQ, a.coordinates.gridR);
  const pb = cellToMeters(b.coordinates.gridQ, b.coordinates.gridR);
  return Math.hypot(pa.x - pb.x, pa.z - pb.z);
}

interface DistanceStats {
  readonly homes: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

function distanceStats(state: CityState, filter: (home: LandPlot) => boolean): DistanceStats {
  const distances: number[] = [];
  for (const home of state.lands) {
    if (!home.idolHandle || !filter(home)) {
      continue;
    }
    const idolPlot = state.plotIndexByMinter.get(home.idolHandle);
    if (idolPlot === undefined) {
      continue;
    }
    distances.push(metersBetween(home, state.lands[idolPlot]));
  }
  distances.sort((x, y) => x - y);
  return { homes: distances.length, p50: Math.round(quantile(distances, 0.5)), p95: Math.round(quantile(distances, 0.95)), max: Math.round(distances[distances.length - 1] ?? 0) };
}

/** Lots that touch a lot of another city: > 0 means two cities have grown into each other. */
function cityBorderLots(state: CityState): number {
  const cityAt = new Map<string, CityId>();
  for (const land of state.lands) {
    const spread = land.footprint === 'BLOCK' ? 1 : 0;
    for (let dq = -spread; dq <= spread; dq += 1) {
      for (let dr = -spread; dr <= spread; dr += 1) {
        cityAt.set(`${land.coordinates.gridQ + dq}:${land.coordinates.gridR + dr}`, land.city);
      }
    }
  }
  let border = 0;
  for (const [key, city] of cityAt) {
    const [q, r] = key.split(':').map(Number);
    const touches = [[1, 0], [0, 1]].some(([dq, dr]) => {
      const other = cityAt.get(`${q + dq}:${r + dr}`);
      return other !== undefined && other !== city;
    });
    border += touches ? 1 : 0;
  }
  return border;
}

/** Must stay 0: every lot of a property lies inside its own city's territory. */
function lotsOutsideTerritory(state: CityState): number {
  let outside = 0;
  for (const land of state.lands) {
    const spread = land.footprint === 'BLOCK' ? 1 : 0;
    for (let dq = -spread; dq <= spread; dq += 1) {
      for (let dr = -spread; dr <= spread; dr += 1) {
        outside += territoryOf(land.coordinates.gridQ + dq, land.coordinates.gridR + dr) === land.city ? 0 : 1;
      }
    }
  }
  return outside;
}

/** How tightly the fans of each fan-turned-idol cluster: mean distance to their own centroid. */
function clusterSpread(state: CityState, idols: ReadonlySet<string>): { readonly clusters: number; readonly p50: number; readonly p95: number } {
  const homesByIdol = new Map<string, { x: number; z: number }[]>();
  for (const home of state.lands) {
    if (home.idolHandle && idols.has(home.idolHandle)) {
      const list = homesByIdol.get(home.idolHandle) ?? [];
      list.push(cellToMeters(home.coordinates.gridQ, home.coordinates.gridR));
      homesByIdol.set(home.idolHandle, list);
    }
  }
  const spreads: number[] = [];
  for (const homes of homesByIdol.values()) {
    if (homes.length < 5) {
      continue;
    }
    const cx = homes.reduce((s, p) => s + p.x, 0) / homes.length;
    const cz = homes.reduce((s, p) => s + p.z, 0) / homes.length;
    spreads.push(homes.reduce((s, p) => s + Math.hypot(p.x - cx, p.z - cz), 0) / homes.length);
  }
  spreads.sort((a, b) => a - b);
  return { clusters: spreads.length, p50: Math.round(quantile(spreads, 0.5)), p95: Math.round(quantile(spreads, 0.95)) };
}

function hexToRgb(hex: string): readonly [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function writePng(path: string, width: number, height: number, rgb: Uint8Array): void {
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    rgb.subarray(y * width * 3, (y + 1) * width * 3).forEach((v, i) => {
      raw[y * (width * 3 + 1) + 1 + i] = v;
    });
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  writeFileSync(path, Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]));
}

function renderMap(state: CityState, path: string, maxPixels = 1600): void {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const points = [...state.lands.map((l) => cellToMeters(l.coordinates.gridQ, l.coordinates.gridR)), ...CITY_SITES.map((s) => cellToMeters(s.centerQ, s.centerR))];
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const margin = 120;
  const metersPerPixel = Math.max(2, (Math.max(maxX - minX, maxZ - minZ) + 2 * margin) / maxPixels);
  const width = Math.ceil((maxX - minX + 2 * margin) / metersPerPixel);
  const height = Math.ceil((maxZ - minZ + 2 * margin) / metersPerPixel);
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    rgb.set([10, 12, 28], i * 3);
  }
  const paint = (x: number, z: number, sizeMeters: number, color: readonly [number, number, number]): void => {
    const half = sizeMeters / 2;
    const x0 = Math.floor((x - half - minX + margin) / metersPerPixel);
    const x1 = Math.max(x0, Math.ceil((x + half - minX + margin) / metersPerPixel) - 1);
    const z0 = Math.floor((z - half - minZ + margin) / metersPerPixel);
    const z1 = Math.max(z0, Math.ceil((z + half - minZ + margin) / metersPerPixel) - 1);
    for (let py = Math.max(0, z0); py <= Math.min(height - 1, z1); py += 1) {
      for (let px = Math.max(0, x0); px <= Math.min(width - 1, x1); px += 1) {
        rgb.set(color, (py * width + px) * 3);
      }
    }
  };
  const avenueWidth = BLOCK_PITCH_METERS;
  const reach = Math.max(maxX - minX, maxZ - minZ) * 2 + 4 * margin;
  paint(0, 0, avenueWidth, [22, 34, 70]);
  for (let s = -reach; s <= reach; s += avenueWidth / 2) {
    paint(s, 0, avenueWidth, [22, 34, 70]);
    paint(0, s, avenueWidth, [22, 34, 70]);
  }
  const capital = cellToMeters(GENESIS_RADIUS_LOTS, 0).x;
  for (let a = 0; a < Math.PI * 2; a += 0.01) {
    paint(Math.cos(a) * capital, Math.sin(a) * capital, metersPerPixel * 3, [58, 214, 255]);
  }
  const lotPaint = LOT_SIZE_METERS * 0.82;
  for (const land of state.lands) {
    if (!land.idolHandle) {
      continue;
    }
    const [r, g, b] = hexToRgb(resolveFandomMetadata(land.fandomHandle).neonColorHex);
    const p = cellToMeters(land.coordinates.gridQ, land.coordinates.gridR);
    paint(p.x, p.z, lotPaint, [Math.round(r * 0.7), Math.round(g * 0.7), Math.round(b * 0.7)]);
  }
  for (const land of state.lands) {
    if (land.idolHandle) {
      continue;
    }
    const p = cellToMeters(land.coordinates.gridQ, land.coordinates.gridR);
    const size = land.footprint === 'BLOCK' ? LOT_SIZE_METERS * 3 : LOT_SIZE_METERS;
    const glow = fansOf(state, land.minterHandle) >= 20 ? 255 : 210;
    paint(p.x, p.z, size + metersPerPixel * 2, [glow, glow, glow]);
    paint(p.x, p.z, Math.max(metersPerPixel, size - metersPerPixel * 2), hexToRgb(resolveFandomMetadata(land.minterHandle).neonColorHex));
  }
  for (const site of CITY_SITES) {
    const p = cellToMeters(site.centerQ, site.centerR);
    paint(p.x, p.z, LOT_SIZE_METERS * 3, hexToRgb(site.colorHex));
    paint(p.x, p.z, LOT_SIZE_METERS * 1.2, [255, 255, 255]);
  }
  writePng(path, width, height, rgb);
}

function main(): void {
  const total = parseFlag('--comments', '60000', 100, 2_000_000);
  // 0 = never reorganize (positions stay where they were first placed).
  const epochComments = parseFlag('--epoch-comments', '0', 0, 2_000_000);
  const random = rng(20261016);
  const state = createCityState({ ...DEFAULT_LEDGER_CONFIG, layoutEpochMs: epochComments > 0 ? epochComments * COMMENT_SPACING_MS : null });
  const outDir = resolve('data/previews', epochComments > 0 ? `epoch-${epochComments}` : 'no-epoch');
  mkdirSync(outDir, { recursive: true });
  const stages = [Math.round(total / 30), Math.round(total / 3), total];
  const timings: number[] = [];
  const risingStars: string[] = [];
  let nextFan = 0;

  for (let i = 0; i < total; i += 1) {
    const author = `fan_${nextFan}`;
    nextFan += 1;
    const roll = random();
    let idol: string;
    if (roll < FAN_OF_FAN_SHARE && risingStars.length > 20) {
      idol = risingStars[zipfIndex(random, risingStars.length)];
    } else if (roll < FAN_OF_FAN_SHARE + 0.03) {
      idol = `unknown_artist_${zipfIndex(random, UNKNOWN_IDOL_POOL)}`;
    } else {
      idol = pickBigIdol(random);
    }
    const started = performance.now();
    const outcome = applyCommentEvent(state, {
      commentId: `sim_${i}`,
      mediaId: 'post_1',
      text: `@${idol} 💜`,
      authorUsername: author,
      authorId: null,
      receivedAtMs: 1_760_000_000_000 + i * COMMENT_SPACING_MS,
    });
    timings.push(performance.now() - started);
    if (outcome.status === 'REJECTED') {
      throw new Error(`Simulation comment rejected: ${outcome.code}`);
    }
    if (risingStars.length < RISING_STAR_POOL) {
      risingStars.push(author);
    }

    if (stages.includes(i + 1)) {
      if (epochComments > 0) {
        // Show each stage as the city looks right after it reorganizes.
        const started = performance.now();
        settleLayout(state);
        console.log(JSON.stringify({ settleMs: Math.round(performance.now() - started), properties: state.lands.length }));
      }
      const sorted = [...timings].sort((x, y) => x - y);
      const cells = new Set(state.lands.map((l) => `${l.coordinates.gridQ}:${l.coordinates.gridR}`));
      const risingSet = new Set(risingStars);
      const file = resolve(outDir, `growth-${String(i + 1).padStart(7, '0')}.png`);
      renderMap(state, file);
      const report = {
        comments: i + 1,
        properties: state.lands.length,
        overlaps: state.lands.length - cells.size,
        btsFans: fansOf(state, 'bts.bighitofficial'),
        btsHomesMeters: distanceStats(state, (h) => h.idolHandle === 'bts.bighitofficial'),
        bigIdolHomesMeters: distanceStats(state, (h) => BIG_IDOLS.some(([handle]) => handle === h.idolHandle)),
        fanOfFanHomesMeters: distanceStats(state, (h) => h.idolHandle !== null && risingSet.has(h.idolHandle)),
        fanOfFanClusterSpreadMeters: clusterSpread(state, risingSet),
        cityBorderLots: cityBorderLots(state),
        lotsOutsideTerritory: lotsOutsideTerritory(state),
        heapMb: Math.round(process.memoryUsage().heapUsed / 1e6),
        placementMs: { p50: Number(quantile(sorted, 0.5).toFixed(3)), p99: Number(quantile(sorted, 0.99).toFixed(3)), max: Number((sorted[sorted.length - 1] ?? 0).toFixed(1)) },
        map: file,
      };
      console.log(JSON.stringify(report));
    }
  }
}

main();
