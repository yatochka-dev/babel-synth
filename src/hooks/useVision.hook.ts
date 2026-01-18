"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DrawingUtils,
  FaceLandmarker,
  HandLandmarker,
  PoseLandmarker,
} from "@mediapipe/tasks-vision";

import { getVision } from "~/hooks/vision/visionCache";
import {
  computeFaceFeatures,
  computeHandFeatures,
  computePoseFeatures,
  type FeatureState,
} from "~/hooks/vision/features";
import { clamp01, deadzone, type Pt } from "~/hooks/vision/math";

export function useVision(
  videoRef: React.RefObject<HTMLVideoElement>,
  enabled: boolean,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [features, setFeatures] = useState<FeatureState>({
    pinch: 0,
    handOpen: 0,
    handHeight: 0,
    smile: 0,
    tension: 0,
    shoulderWidth: 0,
    armRaise: 0,
  });

  const [debugBlend, setDebugBlend] = useState<
    Array<{ name: string; score: number }>
  >([]);

  // smoothing + baseline refs
  const smoothRef = useRef<FeatureState | null>(null);
  const baselineRef = useRef<FeatureState>({
    pinch: 0,
    handOpen: 0,
    handHeight: 0,
    smile: 0,
    tension: 0,
    shoulderWidth: 0,
    armRaise: 0,
  });

  const calibrate = useCallback(() => {
    if (smoothRef.current) baselineRef.current = { ...smoothRef.current };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let handLm: HandLandmarker | null = null;
    let faceLm: FaceLandmarker | null = null;
    let poseLm: PoseLandmarker | null = null;

    let raf = 0;

    // throttles
    let lastHandsPose = 0;
    let lastFace = 0;
    let lastUi = 0;

    // latest results (kept outside React state)
    let lastHands: Pt[][] = [];
    let lastPose: Pt[] | null = null;
    let lastBlend: Array<{ name: string; score: number }> = [];

    const run = async () => {
      const vision = await getVision();

      handLm = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        },
        runningMode: "VIDEO",
        numHands: 2,
      });

      faceLm = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });

      poseLm = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
        },
        runningMode: "VIDEO",
        numPoses: 1,
      });

      const loop = (now: number) => {
        const v = videoRef.current;
        const c = canvasRef.current;

        if (!v || !c || !handLm || !faceLm || !poseLm) {
          raf = requestAnimationFrame(loop);
          return;
        }

        const ctx = c.getContext("2d");
        if (!ctx) {
          raf = requestAnimationFrame(loop);
          return;
        }

        // resize canvas to video
        const w = v.videoWidth;
        const h = v.videoHeight;
        if (w && h && (c.width !== w || c.height !== h)) {
          c.width = w;
          c.height = h;
        }

        // detection throttles
        const DO_HANDS_POSE_EVERY = 50; // ~20fps
        const DO_FACE_EVERY = 100; // ~10fps

        if (now - lastHandsPose >= DO_HANDS_POSE_EVERY) {
          lastHandsPose = now;

          const hr = handLm.detectForVideo(v, now);
          lastHands = (hr.landmarks ?? []) as unknown as Pt[][];

          const pr = poseLm.detectForVideo(v, now);
          lastPose = ((pr.landmarks ?? [])[0] as unknown as Pt[]) ?? null;
        }

        if (now - lastFace >= DO_FACE_EVERY) {
          lastFace = now;

          const fr = faceLm.detectForVideo(v, now);
          const cats = fr.faceBlendshapes?.[0]?.categories ?? [];
          lastBlend = cats.map((c) => ({
            name: c.categoryName,
            score: c.score ?? 0,
          }));
        }

        // draw (hands + upper body)
        ctx.clearRect(0, 0, c.width, c.height);
        const draw = new DrawingUtils(ctx);

        for (const lm of lastHands) {
          draw.drawConnectors(lm as any, HandLandmarker.HAND_CONNECTIONS);
          draw.drawLandmarks(lm as any, { radius: 2 });
        }

        if (lastPose) {
          const p = lastPose;
          const idxPairs: Array<[number, number]> = [
            [11, 12], // shoulders
            [11, 13],
            [13, 15], // left arm
            [12, 14],
            [14, 16], // right arm
          ];

          for (const [a, b] of idxPairs) {
            const A = p[a];
            const B = p[b];
            if (A && B) {
              // quick line draw
              draw.drawConnectors([A, B] as any, [[0, 1]] as any);
            }
          }

          const points = [11, 12, 13, 14, 15, 16]
            .map((i) => p[i])
            .filter(Boolean);
          draw.drawLandmarks(points as any, { radius: 2 });
        }

        // features (pure funcs)
        // compute raw from latest detections
        const raw: FeatureState = {
          ...computeHandFeatures(lastHands),
          ...computeFaceFeatures(lastBlend),
          ...computePoseFeatures(lastPose),
        };

        // EMA smoothing
        const alpha = 0.2;
        if (!smoothRef.current) {
          // initialize smoother with first raw reading
          smoothRef.current = raw;
        } else {
          const prev = smoothRef.current;
          smoothRef.current = {
            pinch: prev.pinch + alpha * (raw.pinch - prev.pinch),
            handOpen: prev.handOpen + alpha * (raw.handOpen - prev.handOpen),
            handHeight:
              prev.handHeight + alpha * (raw.handHeight - prev.handHeight),
            smile: prev.smile + alpha * (raw.smile - prev.smile),
            tension: prev.tension + alpha * (raw.tension - prev.tension),
            shoulderWidth:
              prev.shoulderWidth +
              alpha * (raw.shoulderWidth - prev.shoulderWidth),
            armRaise: prev.armRaise + alpha * (raw.armRaise - prev.armRaise),
          };
        }

        // update UI at ~10fps (throttled)
        if (now - lastUi >= 100) {
          lastUi = now;

          // normalize vs baseline and clamp
          const b = baselineRef.current;
          const s = smoothRef.current ?? raw; // fallback in case

          const normalized: FeatureState = {
            pinch: deadzone(clamp01(s.pinch - b.pinch + 0.5)),
            handOpen: deadzone(clamp01(s.handOpen - b.handOpen + 0.5)),
            handHeight: deadzone(clamp01(s.handHeight - b.handHeight + 0.5)),
            smile: deadzone(clamp01(s.smile - b.smile + 0.5)),
            tension: deadzone(clamp01(s.tension - b.tension + 0.5)),
            shoulderWidth: deadzone(
              clamp01(s.shoulderWidth - b.shoulderWidth + 0.5),
            ),
            armRaise: deadzone(clamp01(s.armRaise - b.armRaise + 0.5)),
          };

          setFeatures(normalized);

          const top = [...lastBlend]
            .sort((a, b) => b.score - a.score)
            .slice(0, 6)
            .map((c) => ({ name: c.name, score: Number(c.score.toFixed(3)) }));
          setDebugBlend(top);
        }

        raf = requestAnimationFrame(loop);
      };

      raf = requestAnimationFrame(loop);
    };

    void run();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      handLm?.close();
      faceLm?.close();
      poseLm?.close();
    };
  }, [videoRef, enabled]);

  return { canvasRef, features, debugBlend, calibrate };
}
