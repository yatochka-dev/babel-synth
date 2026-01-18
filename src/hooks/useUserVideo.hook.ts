"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
          (videoRef.current as HTMLVideoElement).srcObject = null;
          videoRef.current.pause();
        } catch {
          // ignore
        }
      }
    }
  }, []);

  const mapDomException = (e: unknown) => {
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
        if (message && /aborted|cancelled/i.test(message)) {
          return "Camera request was cancelled. Try again and allow the permission prompt.";
        }
        return message || "Unable to access the camera.";
    }
  };

  const start = useCallback(async () => {
    if (streamRef.current) {
      setReady(true);
      setError(null);
      return;
    }

    setRequesting(true);
    setError(null);

    let stream: MediaStream | null = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });

      // assign stream
      streamRef.current = stream;

      const v = videoRef.current;
      if (!v) {
        setReady(true);
        setRequesting(false);
        return;
      }

      try {
        v.srcObject = stream;

        await (v as any).play();
        setReady(true);
        setError(null);
      } catch (playErr) {
        setReady(false);
        setError(
          "Camera stream attached but playback was blocked. Interact with the page (click) to start the camera preview.",
        );
      }
    } catch (err) {
      const friendly = mapDomException(err);
      setError(friendly);
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

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (cancelled) return;
      await start();
    })();

    return () => {
      cancelled = true;

      stop();
    };
    // note: start and stop are stable via useCallback with empty deps
  }, [start, stop]);

  const retry = useCallback(() => {
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
