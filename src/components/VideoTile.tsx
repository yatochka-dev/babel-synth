import { useEffect, useRef } from "react";

interface VideoTileProps {
  stream?: MediaStream | null;
  isLocal?: boolean;
  isMuted?: boolean;
  name?: string;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}

export default function VideoTile({
  stream,
  isLocal,
  isMuted,
  name,
  videoRef: externalRef,
}: VideoTileProps) {
  const internalRef = useRef<HTMLVideoElement>(null);
  const ref = externalRef ?? internalRef; // Use external ref if provided, else internal

  useEffect(() => {
    // If externalRef is provided (for local), it's already handled in hook usually.
    // But for remote streams passed here, we need to attach it.
    if (!isLocal && stream && ref.current) {
      ref.current.srcObject = stream;
    }
  }, [stream, isLocal, ref]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-gray-900 shadow-lg">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={isLocal || (isMuted ?? false)} // Always mute local video to prevent echo
        className={`h-full w-full object-cover ${isLocal ? "-scale-x-100" : ""}`}
      />
      <div className="absolute bottom-3 left-3 rounded-md bg-black/50 px-2 py-1 text-sm font-medium text-white backdrop-blur-sm">
        {name ?? (isLocal ? "You" : "User")} {isMuted && "(Muted)"}
      </div>
    </div>
  );
}
