/**
 * Golden-angle geometry shared by the city layout.
 */

export const GOLDEN_ANGLE_DEGREES = 137.50776405003785;
export const GOLDEN_ANGLE_RADIANS = (GOLDEN_ANGLE_DEGREES * Math.PI) / 180;

/** Point k of a Vogel spiral around (centerQ, centerR), radius = scale·√k, snapped to the grid. */
export function spiralCell(k: number, scale: number, centerQ = 0, centerR = 0): { readonly q: number; readonly r: number } {
  const angle = k * GOLDEN_ANGLE_RADIANS;
  const radius = scale * Math.sqrt(k);
  // `|| 0` turns -0 into 0 so coordinates compare and serialise cleanly.
  return { q: centerQ + Math.round(radius * Math.cos(angle)) || 0, r: centerR + Math.round(radius * Math.sin(angle)) || 0 };
}
