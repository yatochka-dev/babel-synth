"use client";
import { useEffect, useRef, useState } from "react";
import type { FeatureState } from "./vision/features";
import { clamp01 } from "./vision/math";

type TMood = "calm" | "neutral" | "tense";

export default function useMaestro({ features }: { features: FeatureState }) {
  // BPM can be continuous (audio engine should smooth it)
  const targetBPM = 80 + features.tension * 40;

  const lastFeaturesRef = useRef(features);
  useEffect(() => {
    lastFeaturesRef.current = features;
  }, [features]);

  const moodRef = useRef<TMood>("neutral");
  const [mood, setMood] = useState<TMood>("neutral");

  useEffect(() => {
    const id = setInterval(() => {
      const f = lastFeaturesRef.current;

      const moodValue = clamp01(0.7 * f.tension + 0.3 * (1 - f.smile));
      let next = moodRef.current;

      // hysteresis for smooth mood transitions
      if (next === "calm" && moodValue > 0.45) next = "neutral";
      else if (next === "neutral") {
        if (moodValue < 0.35) next = "calm";
        else if (moodValue > 0.7) next = "tense";
      } else if (next === "tense" && moodValue < 0.6) next = "neutral";

      if (next !== moodRef.current) {
        moodRef.current = next;
        setMood(next);
      }
    }, 400);

    return () => clearInterval(id);
  }, []);

  return { targetBPM, mood };
}
