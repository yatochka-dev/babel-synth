"use client";

import React, { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { DebugFeatures } from "~/components/debug-features";
import { useUserVideo } from "~/hooks/useUserVideo.hook";
import { useVision } from "~/hooks/useVision.hook";
import { useRoomAudioPlayer } from "~/hooks/useSync.hook";

type Props = {
  id: string;
};

export default function Room({ id }: Props) {
  const { videoRef, ready, requesting, error, retry } = useUserVideo();
  const { canvasRef, features, calibrate } = useVision(videoRef, ready);

  const [calibrated, setCalibrated] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  const { clientId, connected, audioReady, audioError, startAudio, stopAudio } =
    useRoomAudioPlayer(id, features, "ws://127.0.0.1:5000");

  const calibrateRef = useRef(calibrate);
  useEffect(() => {
    calibrateRef.current = calibrate;
  }, [calibrate]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      try {
        calibrateRef.current();
        setCalibrated(true);
      } catch {
        setCalibrated(false);
      } finally {
        setCalibrating(false);
        setCountdown(null);
      }
      return;
    }

    const t = window.setTimeout(
      () => setCountdown((c) => (c === null ? null : c - 1)),
      1000,
    );
    return () => window.clearTimeout(t);
  }, [countdown]);

  const beginCalibration = () => {
    if (!ready) return;
    setCalibrating(true);
    setCalibrated(false);
    setCountdown(3);
  };

  const cancelCalibration = () => {
    setCalibrating(false);
    setCountdown(null);
  };

  return (
    <div className="space-y-6">
      <DebugFeatures features={features} />
      {!calibrated ? (
        <>
          <div>
            <h2 className="text-lg font-semibold">Calibration</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Position yourself with a neutral face. Raise one relaxed hand so
              all fingers are visible near the center of the frame.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="border-border relative aspect-video overflow-hidden rounded-md border bg-black">
              <video
                ref={videoRef}
                className="h-full w-full object-cover"
                playsInline
                autoPlay
                muted
              />
              {calibrating && countdown !== null && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <div className="text-center">
                    <div className="text-5xl font-bold">{countdown}</div>
                    <div className="text-muted-foreground mt-2 text-sm">
                      Hold still...
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="border-border relative aspect-video overflow-hidden rounded-md border bg-black">
              <canvas ref={canvasRef} className="h-full w-full" />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="text-sm">
              {error ? (
                <span className="text-destructive">{error}</span>
              ) : requesting ? (
                <span className="text-muted-foreground">
                  Requesting camera...
                </span>
              ) : ready ? (
                <span className="text-green-500">Camera ready</span>
              ) : (
                <span className="text-muted-foreground">
                  Camera not started
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {error ? (
                <Button variant="outline" onClick={() => retry()}>
                  Retry camera
                </Button>
              ) : !calibrating ? (
                <Button onClick={beginCalibration} disabled={!ready}>
                  Calibrate
                </Button>
              ) : (
                <>
                  <Button disabled>
                    {countdown !== null ? `${countdown}...` : "Calibrating..."}
                  </Button>
                  <Button variant="outline" onClick={cancelCalibration}>
                    Cancel
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="border-border bg-secondary/50 grid grid-cols-3 gap-4 rounded-md border p-4 text-sm">
            <div>
              <div className="text-muted-foreground">Smile</div>
              <div className="font-mono">{features.smile.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Hand open</div>
              <div className="font-mono">{features.handOpen.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Arm raise</div>
              <div className="font-mono">{features.armRaise.toFixed(2)}</div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Audio Controls</h2>
              <p className="text-muted-foreground text-sm">
                Calibration complete — ready to start audio.
              </p>
            </div>

            <div className="flex items-center gap-3">
              {!audioReady ? (
                <Button onClick={startAudio}>Start audio</Button>
              ) : (
                <Button variant="secondary" onClick={stopAudio}>
                  Stop audio
                </Button>
              )}
            </div>
          </div>

          <div className="border-border bg-secondary/50 flex items-center gap-6 rounded-md border p-4 text-sm">
            <div>
              <span className="text-muted-foreground">WebSocket: </span>
              <span
                className={connected ? "text-green-500" : "text-destructive"}
              >
                {connected ? "connected" : "disconnected"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Client: </span>
              <span className="font-mono text-xs">{clientId.slice(0, 8)}</span>
            </div>
          </div>

          {audioError && (
            <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border p-4 text-sm">
              Audio error: {audioError}
            </div>
          )}

          <div aria-hidden className="sr-only">
            <video ref={videoRef} muted playsInline autoPlay />
            <canvas ref={canvasRef} />
          </div>
        </>
      )}
    </div>
  );
}
