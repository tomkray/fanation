/**
 * The city reorganizes itself (Axiom A3). Who owns what, the fan graph, XP and
 * $NEFA never change; positions are a view of the fan tree that is rebuilt
 * from scratch at each layout epoch around Genesis:
 *
 * - founding idols (catalogued landmarks, and people who were named before
 *   they had a home) are placed biggest following first, so the largest idols
 *   always hold the centre and move towards Genesis as they grow;
 * - each idol's tree is then laid out depth-first in arrival order: a fan's
 *   home goes next to their idol, and if that fan has fans of their own, their
 *   whole neighbourhood is built right there before the idol's next fan.
 *
 * Every following ends up in one piece, nested as deep as fans become idols,
 * and the earliest fans stay closest. Between epochs new homes are added
 * incrementally (nearest free lot); the next epoch tidies them in.
 */

import type { CityState } from './cityLedger.js';
import { cellToMeters, GridCell, placeHomeNear, placeIdolAnchor, resetCityLayout } from './cityLayout.js';
import { LandPlot } from './types.js';

/** Lots a property takes: a landmark block or a single lot. */
function footprintLots(land: LandPlot): number {
  return land.footprint === 'BLOCK' ? 9 : 1;
}

function withCell(land: LandPlot, cell: GridCell): LandPlot {
  return {
    ...land,
    city: 'GENESIS',
    coordinates: { ...cell, ...cellToMeters(cell.gridQ, cell.gridR) },
  };
}

export function settleLayout(state: CityState): void {
  const { lands, layout } = state;
  resetCityLayout(layout);

  // A home's idol always existed before it (lower plot index), so the fan tree has no cycles.
  const children = new Map<number, number[]>();
  const parentOf = new Int32Array(lands.length).fill(-1);
  for (const land of lands) {
    const parent = land.idolHandle === null ? undefined : state.plotIndexByMinter.get(land.idolHandle);
    if (parent === undefined || parent >= land.plotIndex) {
      continue;
    }
    parentOf[land.plotIndex] = parent;
    const list = children.get(parent) ?? [];
    list.push(land.plotIndex);
    children.set(parent, list);
  }

  // Whole following of each property, in lots (itself included); children always come later.
  const weight = new Float64Array(lands.length);
  for (let plot = lands.length - 1; plot >= 0; plot -= 1) {
    weight[plot] += footprintLots(lands[plot]);
    const parent = parentOf[plot];
    if (parent >= 0) {
      weight[parent] += weight[plot];
    }
  }

  const roots = lands
    .filter((land) => parentOf[land.plotIndex] < 0)
    .sort((a, b) => weight[b.plotIndex] - weight[a.plotIndex] || a.plotIndex - b.plotIndex);

  const place = (plot: number, cell: GridCell): void => {
    lands[plot] = withCell(lands[plot], cell);
  };

  for (const root of roots) {
    place(root.plotIndex, placeIdolAnchor(layout, root.city, root.footprint, root.minterHandle));
    // Explicit stack: fan-of-fan chains can be far deeper than the call stack.
    const stack: { readonly plot: number; readonly kids: readonly number[]; next: number }[] = [
      { plot: root.plotIndex, kids: children.get(root.plotIndex) ?? [], next: 0 },
    ];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.next >= frame.kids.length) {
        stack.pop();
        continue;
      }
      const kid = frame.kids[frame.next];
      frame.next += 1;
      const idol = lands[frame.plot];
      place(kid, placeHomeNear(layout, idol.city, idol.minterHandle, idol.coordinates));
      const grandKids = children.get(kid);
      if (grandKids) {
        stack.push({ plot: kid, kids: grandKids, next: 0 });
      }
    }
  }
}
