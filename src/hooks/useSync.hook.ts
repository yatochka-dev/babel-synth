import { useEffect, useMemo, useRef, useState, useCallback } from "react";

import type { FeatureState } from "./vision/features";

function makeClientId() {
  return crypto.randomUUID();
}

const workletUrl = "/pcm-player.worklet.js";

export function useRoomRawSender(
  roomId: string,
  state: FeatureState,
  wsBaseUrl: string,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const stateRef = useRef(state);
  const clientIdRef = useRef(makeClientId());

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!roomId) return;

    const ws = new WebSocket(
      `${wsBaseUrl.replace(/\/$/, "")}/ws/${roomId}/${clientIdRef.current}`,
    );

    // IMPORTANT: we expect binary audio frames
    ws.binaryType = "arraybuffer";

    wsRef.current = ws;

    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === "tick") console.log("tick", data);
        } catch {
          // ignore non-json text
        }
      }
    };

    const interval = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;

      ws.send(
        JSON.stringify({
          type: "raw",
          ...stateRef.current,
        }),
      );
    }, 500);

    return () => {
      clearInterval(interval);
      try {
        ws.close();
      } catch {}
      wsRef.current = null;
    };
  }, [roomId, wsBaseUrl]);

  return {
    clientId: clientIdRef.current,
    // expose ws in case the audio hook wants it (optional)
    _wsRef: wsRef,
  };
}

export function useRoomAudioPlayer(
  roomId: string,
  state: FeatureState,
  wsBaseUrl: string,
) {
  const { clientId, _wsRef } = useRoomRawSender(roomId, state, wsBaseUrl);

  const [connected, setConnected] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  // We attach WS handlers once the ws exists; since useRoomRawSender owns creation,
  // we watch wsRef.current via polling in an effect.
  useEffect(() => {
    let cancelled = false;

    const attach = () => {
      if (cancelled) return;

      const ws = _wsRef.current;
      if (!ws) {
        // try again soon until the ws is created
        setTimeout(attach, 50);
        return;
      }

      const prevOnOpen = ws.onopen;
      const prevOnClose = ws.onclose;
      const prevOnError = ws.onerror;
      const prevOnMessage = ws.onmessage;

      ws.onopen = (ev) => {
        setConnected(true);
        prevOnOpen?.(ev as any);
      };
      ws.onclose = (ev) => {
        setConnected(false);
        prevOnClose?.(ev as any);
      };
      ws.onerror = (ev) => {
        setConnected(false);
        prevOnError?.(ev as any);
      };

      ws.onmessage = (ev) => {
        // keep your previous text handler behavior
        if (typeof ev.data === "string") {
          prevOnMessage?.(ev);
          return;
        }

        // Binary audio: PCM16 stereo interleaved
        const node = workletNodeRef.current;
        if (!node) return;

        const ab = ev.data as ArrayBuffer;

        // Transfer ownership to avoid copying
        node.port.postMessage(ab, [ab]);
      };

      return () => {
        // restore old handlers if needed
        ws.onopen = prevOnOpen as any;
        ws.onclose = prevOnClose as any;
        ws.onerror = prevOnError as any;
        ws.onmessage = prevOnMessage as any;
      };
    };

    const cleanup = attach();

    return () => {
      cancelled = true;
      if (typeof cleanup === "function") cleanup();
    };
  }, [_wsRef]);

  const startAudio = useCallback(async () => {
    try {
      if (audioReady) return;

      setAudioError(null);

      const AudioContextCtor =
        window.AudioContext || (window as any).webkitAudioContext;

      const ctx: AudioContext = new AudioContextCtor({
        sampleRate: 48000,
        latencyHint: "interactive",
      });

      // ✅ Load the worklet by URL (Next.js: put file in /public and set workletUrl="/pcm-player.worklet.js")
      // Also: some browsers require the context to be resumed before addModule works reliably.
      if (ctx.state !== "running") {
        await ctx.resume();
      }

      await ctx.audioWorklet.addModule(workletUrl);

      const node = new AudioWorkletNode(ctx, "pcm16-stereo-player", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });

      // Add gain node to reduce volume (0.15 = 15% volume)
      const gainNode = ctx.createGain();
      gainNode.gain.value = 0.15;

      node.connect(gainNode);
      gainNode.connect(ctx.destination);

      gainNodeRef.current = gainNode;

      audioCtxRef.current = ctx;
      workletNodeRef.current = node;
      setAudioReady(true);
    } catch (e: any) {
      setAudioError(e?.message ?? String(e));

      // cleanup partial init
      try {
        workletNodeRef.current?.disconnect();
      } catch {}
      workletNodeRef.current = null;

      try {
        gainNodeRef.current?.disconnect();
      } catch {}
      gainNodeRef.current = null;

      const ctx = audioCtxRef.current;
      audioCtxRef.current = null;
      if (ctx) {
        try {
          await ctx.close();
        } catch {}
      }

      setAudioReady(false);
    }
  }, [audioReady]);
  const stopAudio = useCallback(async () => {
    setAudioReady(false);
    setAudioError(null);

    try {
      workletNodeRef.current?.disconnect();
    } catch {}
    workletNodeRef.current = null;

    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (ctx) {
      try {
        await ctx.close();
      } catch {}
    }
  }, []);

  return {
    clientId,
    connected,
    audioReady,
    audioError,
    startAudio, // must be called from a user gesture (button click)
    stopAudio,
  };
}
