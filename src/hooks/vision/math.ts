export type Pt = { x: number; y: number; z?: number };

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const dist2D = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const palmSize = (hand: Pt[]) => dist2D(hand[0], hand[9]);
export const deadzone = (v: number, center = 0.5, eps = 0.015) =>
  Math.abs(v - center) < eps ? center : v;
