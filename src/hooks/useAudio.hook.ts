/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useEffect, useRef, useState } from "react";

export function useAudio() {
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);

  const oscRef = useRef<OscillatorNode | null>(null);
  const voiceGainRef = useRef<GainNode | null>(null);

  const [status, setStatus] = useState<"idle" | "running" | "suspended">(
    "idle",
  );

  useEffect(() => {
    const ctx = new (
      window.AudioContext || (window as any).webkitAudioContext
    )();

    const master = ctx.createGain();
    master.gain.value = 0.2; // safe default
    master.connect(ctx.destination);

    // test voice
    const voiceGain = ctx.createGain();
    voiceGain.gain.value = 0; // start muted
    voiceGain.connect(master);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 220;
    osc.connect(voiceGain);
    osc.start();

    ctxRef.current = ctx;
    masterRef.current = master;
    voiceGainRef.current = voiceGain;
    oscRef.current = osc;

    setStatus(ctx.state === "running" ? "running" : "suspended");

    return () => {
      osc.stop();
      osc.disconnect();
      voiceGain.disconnect();
      master.disconnect();
      void ctx.close();
      ctxRef.current = null;
      masterRef.current = null;
      voiceGainRef.current = null;
      oscRef.current = null;
    };
  }, []);

  const resume = async () => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (ctx.state !== "running") await ctx.resume();
    setStatus(ctx.state === "running" ? "running" : "suspended");
  };

  const setMaster = (value: number) => {
    const g = masterRef.current;
    if (!g) return;
    g.gain.value = Math.max(0, Math.min(1, value));
  };

  const setToneOn = (on: boolean) => {
    const g = voiceGainRef.current;
    if (!g) return;
    g.gain.value = on ? 0.15 : 0;
  };

  const setFreq = (hz: number) => {
    const osc = oscRef.current;
    if (!osc) return;
    osc.frequency.value = Math.max(40, Math.min(2000, hz));
  };

  return {
    ctxRef,
    masterRef,
    status,
    resume,
    setMaster,
    setToneOn,
    setFreq,
  };
}
