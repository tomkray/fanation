/**
 * City layout (Axiom A3), built to grow forever from Genesis outward.
 *
 * Territory — the grid is cut into blocks of 3×3 lots with a street between
 * blocks. Block row 0 and block column 0 are the two grand avenues; they
 * cross at Genesis (a sacred disc with no properties). Every other lot is
 * the one planet city. Category never splits the map.
 *
 * Placement — fully determined by arrival order:
 * - a catalogued idol named for the first time gets a landmark block on the
 *   next free point of the planet's wide golden spiral around Genesis;
 * - anyone else named before owning a home gets one lot on the same spiral;
 * - a fan's home is the next free lot of a solid disc around the idol's
 *   property, in exact order of distance (integer maths only). Once that disc
 *   is closed in by other districts, the neighbourhood restarts as a new disc
 *   at the free lot nearest to it, so it stays in one piece.
 *
 * Scale — the chunk index (taken lots per chunk) answers "where is the
 * nearest room?" by skipping full chunks in O(1).
 */

import { CITY_SITES, CityId, citySite } from './cities.js';
import { civicVenueLotCentres } from './civic.js';
import { PropertyFootprint } from './property.js';
import { spiralCell } from './spiral.js';

export const LOTS_PER_BLOCK_SIDE = 3;
export const LOT_SIZE_METERS = 16;
export const STREET_WIDTH_METERS = 14;
export const BLOCK_PITCH_METERS = LOTS_PER_BLOCK_SIDE * LOT_SIZE_METERS + STREET_WIDTH_METERS;
/** Blocks per side of a streaming chunk (≈ 500 m). */
export const CHUNK_BLOCKS = 8;
const CHUNK_LOTS = CHUNK_BLOCKS * LOTS_PER_BLOCK_SIDE;
/** Distance between landmark blocks on the Genesis spiral, in lots (≈ two blocks). */
export const LANDMARK_SPACING_CELLS = 6;
/** Lots around the avenues' crossing that belong to Genesis plaza (no properties). */
export const GENESIS_RADIUS_LOTS = 15;
/** @deprecated Alias kept so older scripts keep compiling; use GENESIS_RADIUS_LOTS. */
export const CAPITAL_RADIUS_LOTS = GENESIS_RADIUS_LOTS;
/** Planet spiral places one lot per step. */
const TIGHT_SPIRAL_SCALE = 1 / Math.sqrt(Math.PI);
/** A neighbourhood disc holds up to π·180² ≈ 100k homes before it continues as a new disc. */
const DISC_RADIUS_LOTS = 180;
/** A restart farther than this from the last one is a new neighbourhood (closer ones just fill gaps). */
const NEIGHBOURHOOD_GAP_LOTS = 6;
/** Taken lots in a row before the spiral asks the chunk index where the room is. */
const BASE_PATIENCE = 96;
const MAX_PATIENCE = 1 << 16;
/** Tripwires only: the planet is unbounded, so a free lot always exists. */
const MAX_STEPS = 50_000_000;
const MAX_CHUNK_RINGS = 20_000;
/** Cells are packed into one safe integer: ±33 million lots per axis. */
const CELL_OFFSET = 2 ** 25;
const CELL_STRIDE = 2 ** 26;

export interface GridCell {
  readonly gridQ: number;
  readonly gridR: number;
}

/** Golden spiral from Genesis; it never moves so landmarks spread around the whole planet. */
interface SpiralCursor {
  readonly centerQ: number;
  readonly centerR: number;
  readonly scale: number;
  next: number;
  /** Grows while the chunk index keeps answering "the room is right ahead"; resets after a real jump. */
  patience: number;
}

/** Solid disc around an idol (or around the place their neighbourhood continues). */
interface DiscCursor {
  readonly originQ: number;
  readonly originR: number;
  centerQ: number;
  centerR: number;
  /** Index into the shared distance-ordered offsets. */
  next: number;
}

export interface CityLayout {
  readonly occupied: Set<number>;
  /** Taken lots per `${city}@${chunkQ}:${chunkR}`. */
  readonly fill: Map<string, number>;
  /** Wide spiral for landmark blocks (one for the planet). */
  readonly landmarkCursors: Map<CityId, SpiralCursor>;
  /** Tight spiral for one-lot idol anchors. */
  readonly lotCursors: Map<CityId, SpiralCursor>;
  /** One disc per idol for their fans' homes. */
  readonly homeCursors: Map<string, DiscCursor>;
  /** Where each idol's neighbourhood continued after being closed in, so the map can link it back to the idol. */
  readonly neighbourhoods: Map<string, GridCell[]>;
}

/** Block index of a lot: lots -1..1 are block 0, 2..4 block 1, -4..-2 block -1. */
export function blockOf(cell: number): number {
  return Math.floor((cell + 1) / LOTS_PER_BLOCK_SIDE);
}

/**
 * The city that owns a lot, or null for the grand avenues and the Genesis
 * plaza (nothing is minted there).
 */
export function territoryOf(q: number, r: number): CityId | null {
  const blockQ = blockOf(q);
  const blockR = blockOf(r);
  if (blockQ === 0 || blockR === 0) {
    return null;
  }
  if (q * q + r * r <= GENESIS_RADIUS_LOTS * GENESIS_RADIUS_LOTS) {
    return null;
  }
  return 'GENESIS';
}

function chunkOf(cell: number): number {
  return Math.floor(blockOf(cell) / CHUNK_BLOCKS);
}

function chunkFirstLot(chunk: number): number {
  return chunk * CHUNK_LOTS - 1;
}

export function chunkKeyOfCell(gridQ: number, gridR: number): string {
  return `${chunkOf(gridQ)}:${chunkOf(gridR)}`;
}

function cellId(q: number, r: number): number {
  return (q + CELL_OFFSET) * CELL_STRIDE + (r + CELL_OFFSET);
}

function fillKey(city: CityId, chunkQ: number, chunkR: number): string {
  return `${city}@${chunkQ}:${chunkR}`;
}

/** Distance from a lot to the nearest and farthest lot of a chunk. */
function chunkDistances(q: number, r: number, chunkQ: number, chunkR: number): { readonly near: number; readonly far: number } {
  const q0 = chunkFirstLot(chunkQ);
  const r0 = chunkFirstLot(chunkR);
  const q1 = q0 + CHUNK_LOTS - 1;
  const r1 = r0 + CHUNK_LOTS - 1;
  const nearQ = q < q0 ? q0 - q : q > q1 ? q - q1 : 0;
  const nearR = r < r0 ? r0 - r : r > r1 ? r - r1 : 0;
  return {
    near: Math.hypot(nearQ, nearR),
    far: Math.hypot(Math.max(Math.abs(q - q0), Math.abs(q - q1)), Math.max(Math.abs(r - r0), Math.abs(r - r1))),
  };
}

/** Pure geometry, so it is shared by every layout; only chunks on an avenue or Genesis need a scan. */
const mixedChunkCapacity = new Map<string, number>();

function chunkCapacity(city: CityId, chunkQ: number, chunkR: number): number {
  const q0 = chunkFirstLot(chunkQ);
  const r0 = chunkFirstLot(chunkR);
  const touchesAvenue = chunkQ === 0 || chunkR === 0;
  const touchesGenesis = chunkDistances(0, 0, chunkQ, chunkR).near <= GENESIS_RADIUS_LOTS;
  if (!touchesAvenue && !touchesGenesis) {
    return territoryOf(q0, r0) === city ? CHUNK_LOTS * CHUNK_LOTS : 0;
  }
  const key = fillKey(city, chunkQ, chunkR);
  const cached = mixedChunkCapacity.get(key);
  if (cached !== undefined) {
    return cached;
  }
  let count = 0;
  for (let q = q0; q < q0 + CHUNK_LOTS; q += 1) {
    for (let r = r0; r < r0 + CHUNK_LOTS; r += 1) {
      count += territoryOf(q, r) === city ? 1 : 0;
    }
  }
  mixedChunkCapacity.set(key, count);
  return count;
}

let discOffsetsCache: Int16Array | null = null;

/**
 * Every lot offset within DISC_RADIUS_LOTS, ordered by squared distance and
 * then by angle — compared with integers only, so the order (and therefore
 * every home's position) is identical on any machine and any engine.
 */
function discOffsets(): Int16Array {
  if (discOffsetsCache) {
    return discOffsetsCache;
  }
  const cells: (readonly [number, number])[] = [];
  const limit = DISC_RADIUS_LOTS * DISC_RADIUS_LOTS;
  for (let q = -DISC_RADIUS_LOTS; q <= DISC_RADIUS_LOTS; q += 1) {
    for (let r = -DISC_RADIUS_LOTS; r <= DISC_RADIUS_LOTS; r += 1) {
      if (q * q + r * r <= limit) {
        cells.push([q, r]);
      }
    }
  }
  const half = ([q, r]: readonly [number, number]): number => (r > 0 || (r === 0 && q > 0) ? 0 : 1);
  cells.sort((a, b) => {
    const byDistance = a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]);
    if (byDistance !== 0) {
      return byDistance;
    }
    const byHalf = half(a) - half(b);
    if (byHalf !== 0) {
      return byHalf;
    }
    // Same distance and half-plane: counter-clockwise first. Distinct points here never have a zero cross product.
    return a[0] * b[1] - a[1] * b[0] > 0 ? -1 : 1;
  });
  const packed = new Int16Array(cells.length * 2);
  cells.forEach(([q, r], i) => {
    packed[2 * i] = q;
    packed[2 * i + 1] = r;
  });
  discOffsetsCache = packed;
  return packed;
}

function isFree(layout: CityLayout, city: CityId, q: number, r: number): boolean {
  return territoryOf(q, r) === city && !layout.occupied.has(cellId(q, r));
}

function occupy(layout: CityLayout, q: number, r: number): void {
  layout.occupied.add(cellId(q, r));
  const city = territoryOf(q, r);
  if (city) {
    const key = fillKey(city, chunkOf(q), chunkOf(r));
    layout.fill.set(key, (layout.fill.get(key) ?? 0) + 1);
  }
}

const BLOCK_OFFSETS: readonly (readonly [number, number])[] = [-1, 0, 1].flatMap((dq) =>
  [-1, 0, 1].map((dr) => [dq, dr] as const)
);

function blockIsFree(layout: CityLayout, city: CityId, q: number, r: number): boolean {
  return BLOCK_OFFSETS.every(([dq, dr]) => isFree(layout, city, q + dq, r + dr));
}

function reserveBlock(layout: CityLayout, q: number, r: number): void {
  for (const [dq, dr] of BLOCK_OFFSETS) {
    occupy(layout, q + dq, r + dr);
  }
}

function snapToBlockCentre(cell: number): number {
  return LOTS_PER_BLOCK_SIDE * Math.round(cell / LOTS_PER_BLOCK_SIDE) || 0;
}

interface Room {
  readonly distance: number;
  readonly q: number;
  readonly r: number;
}

/**
 * The free lot of `city` nearest to (centerQ, centerR) at or beyond
 * `fromRadius`. Searches square rings of chunks outward, skipping full chunks
 * in O(1); ties keep the first lot found, which is deterministic.
 */
function nearestRoom(layout: CityLayout, city: CityId, centerQ: number, centerR: number, fromRadius: number): Room {
  const homeQ = chunkOf(centerQ);
  const homeR = chunkOf(centerR);
  let best: Room = { distance: Number.POSITIVE_INFINITY, q: centerQ, r: centerR };
  for (let ring = 0; ring < MAX_CHUNK_RINGS; ring += 1) {
    if (Math.max(0, ring - 1) * CHUNK_LOTS > best.distance) {
      return best;
    }
    for (let dq = -ring; dq <= ring; dq += 1) {
      const edge = Math.abs(dq) === ring;
      for (let dr = -ring; dr <= ring; dr += edge ? 1 : 2 * ring) {
        const chunkQ = homeQ + dq;
        const chunkR = homeR + dr;
        const capacity = chunkCapacity(city, chunkQ, chunkR);
        if (capacity === 0 || (layout.fill.get(fillKey(city, chunkQ, chunkR)) ?? 0) >= capacity) {
          continue;
        }
        const { near, far } = chunkDistances(centerQ, centerR, chunkQ, chunkR);
        if (far < fromRadius || near >= best.distance) {
          continue;
        }
        const q0 = chunkFirstLot(chunkQ);
        const r0 = chunkFirstLot(chunkR);
        for (let q = q0; q < q0 + CHUNK_LOTS; q += 1) {
          for (let r = r0; r < r0 + CHUNK_LOTS; r += 1) {
            const d = Math.hypot(q - centerQ, r - centerR);
            if (d >= fromRadius && d < best.distance && isFree(layout, city, q, r)) {
              best = { distance: d, q, r };
            }
          }
        }
      }
    }
  }
  throw new Error(`No room found in ${city} after ${MAX_CHUNK_RINGS} chunk rings.`);
}

/** Next point of the Genesis spiral that satisfies `accept`, jumping over dense areas via the chunk index. */
function advanceSpiral(
  layout: CityLayout,
  city: CityId,
  cursor: SpiralCursor,
  accept: (q: number, r: number) => boolean,
  owner: string
): GridCell {
  let misses = 0;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const point = spiralCell(cursor.next, cursor.scale, cursor.centerQ, cursor.centerR);
    cursor.next += 1;
    if (accept(point.q, point.r)) {
      return { gridQ: point.q, gridR: point.r };
    }
    misses += 1;
    if (misses < cursor.patience) {
      continue;
    }
    misses = 0;
    const radius = cursor.scale * Math.sqrt(cursor.next);
    const room = nearestRoom(layout, city, cursor.centerQ, cursor.centerR, radius);
    if (room.distance - radius > 1) {
      // Resume just inside the room's radius: radius = scale·√k.
      cursor.next = Math.max(cursor.next, Math.floor(((room.distance - 1) / cursor.scale) ** 2));
      cursor.patience = BASE_PATIENCE;
    } else {
      // Room is right ahead but sparse (e.g. a thin frontier arc): be more patient before asking again.
      cursor.patience = Math.min(MAX_PATIENCE, cursor.patience * 2);
    }
  }
  throw new Error(`No free lot for @${owner} in ${city} after ${MAX_STEPS} steps.`);
}

/** Next free lot of an idol's disc; a closed-in or full disc continues at the nearest free lot. */
function advanceDisc(layout: CityLayout, city: CityId, cursor: DiscCursor, owner: string): GridCell {
  const offsets = discOffsets();
  const size = offsets.length / 2;
  let misses = 0;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (cursor.next < size) {
      const dq = offsets[2 * cursor.next];
      const dr = offsets[2 * cursor.next + 1];
      const q = cursor.centerQ + dq;
      const r = cursor.centerR + dr;
      cursor.next += 1;
      if (isFree(layout, city, q, r)) {
        return { gridQ: q, gridR: r };
      }
      misses += 1;
      // A whole ring (≈ 2πρ lots) without a free lot means the disc is closed in at this radius.
      if (misses < BASE_PATIENCE + 2 * Math.PI * (Math.hypot(dq, dr) + 1)) {
        continue;
      }
    }
    const room = nearestRoom(layout, city, cursor.centerQ, cursor.centerR, 0);
    const trail = layout.neighbourhoods.get(owner) ?? [];
    const last = trail[trail.length - 1] ?? { gridQ: cursor.originQ, gridR: cursor.originR };
    if (Math.hypot(room.q - last.gridQ, room.r - last.gridR) > NEIGHBOURHOOD_GAP_LOTS) {
      trail.push({ gridQ: room.q, gridR: room.r });
      layout.neighbourhoods.set(owner, trail);
    }
    cursor.centerQ = room.q;
    cursor.centerR = room.r;
    cursor.next = 0;
    misses = 0;
  }
  throw new Error(`No free lot for a fan of @${owner} in ${city} after ${MAX_STEPS} steps.`);
}

function newSpiral(centerQ: number, centerR: number, scale: number): SpiralCursor {
  return { centerQ, centerR, scale, next: 1, patience: BASE_PATIENCE };
}

function assertPlaceable(city: CityId): void {
  if (city !== 'GENESIS') {
    throw new Error(`Only Genesis holds properties; got ${String(city)}.`);
  }
}

export function createCityLayout(): CityLayout {
  const layout: CityLayout = {
    occupied: new Set(),
    fill: new Map(),
    landmarkCursors: new Map(),
    lotCursors: new Map(),
    homeCursors: new Map(),
    neighbourhoods: new Map(),
  };
  resetCityLayout(layout);
  return layout;
}

/** Empties the map (plazas only) so it can be rebuilt in place; the object identity is kept. */
export function resetCityLayout(layout: CityLayout): void {
  layout.occupied.clear();
  layout.fill.clear();
  layout.landmarkCursors.clear();
  layout.lotCursors.clear();
  layout.homeCursors.clear();
  layout.neighbourhoods.clear();
  for (const site of CITY_SITES) {
    reserveBlock(layout, site.centerQ, site.centerR);
  }
  // Cultural venues on the Genesis spiral — reserved so homes never claim them.
  for (const cell of civicVenueLotCentres()) {
    reserveBlock(layout, cell.gridQ, cell.gridR);
  }
}

/** Places an idol who has no property yet. Returns the property's centre cell. */
export function placeIdolAnchor(layout: CityLayout, city: CityId, footprint: PropertyFootprint, handle: string): GridCell {
  assertPlaceable(city);
  const site = citySite(city);
  if (footprint === 'LOT') {
    let cursor = layout.lotCursors.get(city);
    if (!cursor) {
      cursor = newSpiral(site.centerQ, site.centerR, TIGHT_SPIRAL_SCALE);
      layout.lotCursors.set(city, cursor);
    }
    const cell = advanceSpiral(layout, city, cursor, (q, r) => isFree(layout, city, q, r), handle);
    occupy(layout, cell.gridQ, cell.gridR);
    return cell;
  }
  let cursor = layout.landmarkCursors.get(city);
  if (!cursor) {
    cursor = newSpiral(site.centerQ, site.centerR, LANDMARK_SPACING_CELLS);
    layout.landmarkCursors.set(city, cursor);
  }
  const point = advanceSpiral(layout, city, cursor, (q, r) => blockIsFree(layout, city, snapToBlockCentre(q), snapToBlockCentre(r)), handle);
  const centre = { gridQ: snapToBlockCentre(point.gridQ), gridR: snapToBlockCentre(point.gridR) };
  reserveBlock(layout, centre.gridQ, centre.gridR);
  return centre;
}

/** The next home of the idol's neighbourhood, for one of their fans. */
export function placeHomeNear(layout: CityLayout, city: CityId, idolHandle: string, idolCell: GridCell): GridCell {
  assertPlaceable(city);
  let cursor = layout.homeCursors.get(idolHandle);
  if (!cursor) {
    cursor = { originQ: idolCell.gridQ, originR: idolCell.gridR, centerQ: idolCell.gridQ, centerR: idolCell.gridR, next: 1 };
    layout.homeCursors.set(idolHandle, cursor);
  }
  const cell = advanceDisc(layout, city, cursor, idolHandle);
  occupy(layout, cell.gridQ, cell.gridR);
  return cell;
}

/** Lots inside a block are 16 m apart; blocks are separated by a 14 m street. */
export function cellToMeters(gridQ: number, gridR: number): { readonly x: number; readonly z: number } {
  const axis = (cell: number): number => {
    const block = blockOf(cell);
    const inBlock = cell - block * LOTS_PER_BLOCK_SIDE;
    return block * BLOCK_PITCH_METERS + inBlock * LOT_SIZE_METERS;
  };
  return { x: axis(gridQ), z: axis(gridR) };
}
