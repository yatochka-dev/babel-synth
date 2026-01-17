"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useWebRTC } from "~/hooks/useWebRTC";
import VideoGrid from "./VideoGrid";
import Controls from "./Controls";

export default function Room({ id }: { id: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const name = searchParams.get("name") ?? "Guest";

  // Client-only mounting check to avoid hydration mismatch with random IDs if any
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const {
    localStream,
    localVideoRef,
    peers,
    toggleMic,
    toggleCamera,
    isMicMuted,
    isCameraOff,
    error,
  } = useWebRTC(id, name);

  if (!mounted)
    return (
      <div className="flex h-screen items-center justify-center text-white">
        Loading...
      </div>
    );

  return (
    <div className="flex min-h-screen flex-col items-center bg-[#101010] text-white">
      <header className="flex w-full items-center justify-between bg-white/5 px-6 py-4 backdrop-blur-sm">
        <div className="flex flex-col">
          <h1 className="text-xl font-bold">
            Room: <span className="text-purple-400">{id}</span>
          </h1>
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
        <div className="text-sm opacity-70">Logged in as: {name}</div>
      </header>

      <main className="flex w-full flex-1 flex-col items-center justify-center overflow-hidden">
        <VideoGrid
          localStream={localStream}
          localVideoRef={localVideoRef}
          peers={peers}
          isMicMuted={isMicMuted}
          userName={name}
        />
      </main>

      <Controls
        isMicMuted={isMicMuted}
        isCameraOff={isCameraOff}
        onToggleMic={toggleMic}
        onToggleCamera={toggleCamera}
        onLeave={() => router.push("/")}
      />
    </div>
  );
}
