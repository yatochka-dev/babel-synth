"use client";
import { useEffect, useRef, useState } from "react";

export function useUserVideo() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        const v = videoRef.current;
        if (!v) return;

        v.srcObject = stream;
        await v.play();
        setReady(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Camera error");
      }
    })();

    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  return { videoRef, ready, error };
}
