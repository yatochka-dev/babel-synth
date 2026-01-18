"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Enhanced getUserMedia hook
 *
 * - Attempts to start the user's camera on mount.
 * - Exposes clearer, mapped error messages.
 * - Provides `retry()` to attempt access again after a failure.
 * - Provides `stop()` to stop any active tracks and reset state.
 *
 * Returns:
 *  {
 *    videoRef,      // attach to <video ref={videoRef} />
 *    ready,         // boolean - true when play() succeeded and stream attached
 *    requesting,    // boolean - true while awaiting permission/stream
 *    error,         // string | null - friendly message when something goes wrong
 *    retry,         // () => void - attempt to start again
 *    stop,          // () => void - stop and release camera
 *  }
 */
export function useUserVideo() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [ready, setReady] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    setRequesting(false);
    setReady(false);
    setError(null);

    try {
      const s = streamRef.current;
      if (s) {
        s.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {
            // ignore
          }
        });
      }
    } finally {
      streamRef.current = null;
      if (videoRef.current) {
        try {
          // disconnect srcObject and pause
          (videoRef.current as HTMLVideoElement).srcObject = null;
          videoRef.current.pause();
        } catch {
          // ignore
        }
      }
    }
  }, []);

  const mapDomException = (e: unknown) => {
    // DOMException may be thrown by getUserMedia; check `name` where available
    const ex = e as any;
    const name = ex?.name ?? "";
    const message = (ex?.message as string) ?? "";

    switch (name) {
      case "NotAllowedError":
      case "PermissionDeniedError": // older browsers
        return "Camera access was denied. Please enable camera permissions in your browser.";
      case "AbortError":
        return "Camera request was cancelled. Try again and allow the permission prompt.";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "No camera device found. Connect a camera or check your system settings.";
      case "NotReadableError":
      case "TrackStartError":
        return "Cannot access the camera (it might be in use by another application). Close other apps and try again.";
      case "OverconstrainedError":
      case "ConstraintNotSatisfiedError":
        return "Camera constraints cannot be satisfied. Try with a different device or allow default settings.";
      case "SecurityError":
        return "Camera access is blocked for this context. Make sure you're on HTTPS or localhost.";
      default:
        // Sometimes browsers simply abort with a generic message; try to infer
        if (message && /aborted|cancelled/i.test(message)) {
          return "Camera request was cancelled. Try again and allow the permission prompt.";
        }
        return message || "Unable to access the camera.";
    }
  };

  const start = useCallback(async () => {
    // If already have a stream, treat as ready
    if (streamRef.current) {
      setReady(true);
      setError(null);
      return;
    }

    setRequesting(true);
    setError(null);

    let stream: MediaStream | null = null;

    try {
      // Request video only; prefer front-facing camera if available
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });

      // assign stream
      streamRef.current = stream;

      const v = videoRef.current;
      if (!v) {
        // element not yet mounted, but stream acquired — keep it in ref and mark ready
        setReady(true);
        setRequesting(false);
        return;
      }

      try {
        v.srcObject = stream;
        // Some browsers require play() to be awaited to confirm media playback
        // Use play() and catch exceptions (e.g. if autoplay blocked)
        // We still consider ready true if play resolves.
        // Note: user gesture is sometimes required for audio. We're video-only, so usually okay.
        // However, browsers may block autoplay; handle gracefully.
        // We attempt to play but don't throw to outer try if it fails; instead set an error message.
        // Await play to detect errors early.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (v as any).play();
        setReady(true);
        setError(null);
      } catch (playErr) {
        // Couldn't play (autoplay blocked or similar) — still keep stream attached,
        // but indicate that playback didn't start automatically.
        // Provide a clear message suggesting user interaction (click) to start.
        setReady(false);
        setError(
          "Camera stream attached but playback was blocked. Interact with the page (click) to start the camera preview.",
        );
      }
    } catch (err) {
      // map known DOMExceptions to friendly messages
      const friendly = mapDomException(err);
      setError(friendly);
      // ensure any partial stream is cleaned up
      if (stream) {
        try {
          stream.getTracks().forEach((t) => t.stop());
        } catch {
          // ignore
        }
        streamRef.current = null;
      }
    } finally {
      setRequesting(false);
    }
  }, []);

  // Automatically attempt to start once on mount.
  useEffect(() => {
    let cancelled = false;

    // Run start but don't await here to avoid blocking render
    void (async () => {
      if (cancelled) return;
      await start();
    })();

    return () => {
      cancelled = true;
      // don't stop the stream on unmount here necessarily,
      // but it's reasonable to stop to release camera when component unmounts
      stop();
    };
    // note: start and stop are stable via useCallback with empty deps
  }, [start, stop]);

  const retry = useCallback(() => {
    // clear previous error and try again
    setError(null);
    void start();
  }, [start]);

  return {
    videoRef,
    ready,
    requesting,
    error,
    retry,
    stop,
  } as const;
}
