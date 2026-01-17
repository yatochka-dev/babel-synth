import { type Pt, clamp01, dist2D, palmSize } from "./math";

export type FeatureState = {
  pinch: number;
  handOpen: number;
  handHeight: number;
  smile: number;
  tension: number;
  shoulderWidth: number;
  armRaise: number;
};
export type FeatureBaseline = FeatureState;

/**
 * Compute hand-related features from detected hand landmark arrays.
 *
 * Be defensive: MediaPipe usually returns 21 landmarks per hand, but some
 * integrations or partial detections may produce shorter arrays. Avoid
 * indexing into undefined entries and gracefully handle missing data.
 */
export function computeHandFeatures(hands: Pt[][]) {
  let pinch = 0,
    handOpen = 0,
    handHeight = 0;

  if (!hands || hands.length === 0) return { pinch, handOpen, handHeight };

  // Prefer hands that look like full hands (21 landmarks). Fallback to any hand.
  const fullHands = hands.filter((h) => Array.isArray(h) && h.length >= 21);
  const candidates = fullHands.length ? fullHands : hands.filter(Boolean);

  if (candidates.length === 0) return { pinch, handOpen, handHeight };

  // Choose the dominant (largest) palm among candidates, but only call palmSize
  // when we expect the array to have the required indices.
  const dom = candidates.reduce((best, cur) =>
    // only compare palmSize if both have sufficient length; otherwise prefer longer
    (
      best.length >= 10 && cur.length >= 10
        ? palmSize(cur) > palmSize(best)
        : cur.length > best.length
    )
      ? cur
      : best,
  );

  // safe accessors: return a fallback Pt when index missing
  const fallbackPt: Pt = { x: 0, y: 1 }; // default wrist-like point (bottom)

  // Compute pinch only if we have the needed points (thumb tip 4 and index tip 8)
  if (dom.length > 8 && dom[4] && dom[8]) {
    pinch = clamp01(dist2D(dom[4] as Pt, dom[8] as Pt) / 0.25);
  } else {
    pinch = 0;
  }

  // Compute handOpen as average distance from finger tips to wrist.
  // Only average over the tips that exist.
  const tipIndices = [8, 12, 16, 20];
  const wrist = (dom[0] ?? fallbackPt) as Pt;
  const presentTips = tipIndices.map((i) => dom[i]).filter(Boolean) as Pt[];

  if (presentTips.length > 0) {
    const sum = presentTips.reduce((s, p) => s + dist2D(p as Pt, wrist), 0);
    const avg = sum / presentTips.length;
    handOpen = clamp01(avg / 0.55);
  } else {
    handOpen = 0;
  }

  // handHeight depends on wrist.y; fallbackPt provides a sensible default.
  handHeight = clamp01(1 - wrist.y);

  return { pinch, handOpen, handHeight };
}

export function computeFaceFeatures(
  blend: Array<{ name: string; score: number }>,
) {
  const get = (name: string) => blend.find((c) => c.name === name)?.score ?? 0;

  const smile = clamp01((get("mouthSmileLeft") + get("mouthSmileRight")) / 2);
  const browDown = (get("browDownLeft") + get("browDownRight")) / 2;
  const squint = (get("eyeSquintLeft") + get("eyeSquintRight")) / 2;
  const tension = clamp01(0.7 * browDown + 0.3 * squint);

  return { smile, tension };
}

export function computePoseFeatures(pose: Pt[] | null) {
  let shoulderWidth = 0,
    armRaise = 0;
  if (!pose) return { shoulderWidth, armRaise };

  const Ls = pose[11],
    Rs = pose[12],
    Lw = pose[15],
    Rw = pose[16];

  if (Ls && Rs) shoulderWidth = clamp01(dist2D(Ls, Rs) / 0.6);

  if (Ls && Lw)
    armRaise = Math.max(armRaise, clamp01((Ls.y - Lw.y + 0.2) / 0.4));
  if (Rs && Rw)
    armRaise = Math.max(armRaise, clamp01((Rs.y - Rw.y + 0.2) / 0.4));

  return { shoulderWidth, armRaise };
}
