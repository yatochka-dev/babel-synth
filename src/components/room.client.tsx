"use client";
import { useUserVideo } from "~/hooks/useUserVideo.hook";
import { useVision } from "~/hooks/useVision.hook";
import { useAudio } from "~/hooks/useAudio.hook";
import useMaestro from "~/hooks/useMaestro.hook";
import { useAiMusic } from "~/hooks/useAIMusic.hook";

export default function Room({ id }: { id: string }) {
  const { videoRef, ready, error } = useUserVideo();
  // const { canvasRef, features, debugBlend, calibrate } = useVision(
  // videoRef,
  // ready,
  // );
  //
  // const d = useMaestro({ features });
  const ai = useAiMusic();

  if (error) return <div className="p-4 text-red-600">{error}</div>;

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold">Room {id}</h2>

      {/*<div className="relative mt-4 w-full max-w-5xl">
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
      </div>*/}

      <div>
        <button onClick={ai.init} className="rounded border px-3 py-1 text-sm">
          Init AI Music
        </button>

        <button
          disabled={ai.status !== "ready"}
          onClick={() => ai.generateAndPlay()}
          className="rounded border px-3 py-1 text-sm disabled:opacity-50"
        >
          Generate + Play (2 bars)
        </button>

        <button onClick={ai.stop} className="rounded border px-3 py-1 text-sm">
          Stop
        </button>

        {ai.error ? <div className="text-red-600">{ai.error}</div> : null}
      </div>

      {/*<pre className="mt-3 text-xs opacity-80">
        {JSON.stringify(features, null, 2)}
      </pre>
      <pre className="mt-3 text-xs opacity-70">
        {debugBlend.length
          ? JSON.stringify(debugBlend, null, 2)
          : "blend: (empty)"}
      </pre>*/}
    </div>
  );
}
