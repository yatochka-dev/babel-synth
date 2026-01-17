/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Status = "idle" | "loading" | "ready" | "error";

export function useAiMusic() {
  const mmRef = useRef<any>(null);
  const modelRef = useRef<any>(null);
  const playerRef = useRef<any>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  // Step 1: init magenta + model + player
  const init = useCallback(async () => {
    try {
      setError(null);
      setStatus("loading");

      // Import only on client
      const mm = await import("@magenta/music");
      mmRef.current = mm;

      // MusicVAE 2-bar melody checkpoint (small + fast)
      const checkpoint =
        "https://storage.googleapis.com/magentadata/js/checkpoints/music_vae/mel_2bar_small";

      const model = new mm.MusicVAE(checkpoint);
      await model.initialize();
      modelRef.current = model;

      // Player (SoundFont-based, simplest to “just hear music”)
      const soundfont =
        "https://storage.googleapis.com/magentadata/js/soundfonts/sgm_plus";
      const player = new mm.SoundFontPlayer(soundfont);
      playerRef.current = player;

      setStatus("ready");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Init failed");
    }
  }, []);

  // Step 1: generate + play a phrase
  const generateAndPlay = useCallback(async () => {
    const mm = mmRef.current;
    const model = modelRef.current;
    const player = playerRef.current;
    if (!mm || !model || !player) throw new Error("Not initialized");

    // Stop current playback if any
    if (player.isPlaying()) player.stop();

    // Sample 1 phrase (2 bars). Temperature controls randomness.
    const [seq] = await model.sample(1, /*temperature*/ 1.0);

    // Preload needed samples for instant start (recommended by docs)
    await player.loadSamples(seq);
    player.start(seq);
  }, []);

  const stop = useCallback(() => {
    const player = playerRef.current;
    if (player?.isPlaying()) player.stop();
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      try {
        const player = playerRef.current;
        if (player?.isPlaying()) player.stop();
      } catch {}
    };
  }, []);

  return { status, error, init, generateAndPlay, stop };
}
