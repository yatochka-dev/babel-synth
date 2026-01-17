"use client";
import { useRoomRawSender } from "~/hooks/useSync.hook";
import { useUserVideo } from "~/hooks/useUserVideo.hook";
import { useVision } from "~/hooks/useVision.hook";

export default function Room({ id }: { id: string }) {
  const { videoRef, ready, error } = useUserVideo();
  const { canvasRef, features, debugBlend, calibrate } = useVision(
    videoRef,
    ready,
  );

  // const d = useMaestro({ features });
  // const player = useAIMusic({
  //   bpm: 200,
  //   mood: "sad",
  //   energy: 0.6,
  //   tension: 1,
  // });
  const {} = useRoomRawSender(id, features, "ws://127.0.0.1:5000");

  if (error) return <div className="p-4 text-red-600">{error}</div>;

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold">Room {id}</h2>

      <div className="relative mt-4 w-full max-w-5xl">
        <video
          ref={videoRef}
          className="w-full rounded border"
          muted
          playsInline
          autoPlay
        />
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute top-0 left-0 h-full w-full"
        />
      </div>

      <pre className="mt-3 text-xs opacity-80">
        {JSON.stringify(features, null, 2)}
      </pre>
      <pre className="mt-3 text-xs opacity-70">
        {debugBlend.length
          ? JSON.stringify(debugBlend, null, 2)
          : "blend: (empty)"}
      </pre>
    </div>
  );
}
