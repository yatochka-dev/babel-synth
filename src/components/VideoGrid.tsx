import VideoTile from "./VideoTile";

interface VideoGridProps {
  localStream: MediaStream | null;
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  peers: Record<string, MediaStream>;
  isMicMuted: boolean;
  userName?: string;
}

export default function VideoGrid({
  localStream,
  localVideoRef,
  peers,
  isMicMuted,
  userName,
}: VideoGridProps) {
  const peerIds = Object.keys(peers);
  const totalUsers = peerIds.length + 1;

  // Simple grid logic
  let gridCols = "grid-cols-1";
  if (totalUsers >= 2) gridCols = "md:grid-cols-2";
  if (totalUsers >= 3) gridCols = "md:grid-cols-2 lg:grid-cols-3"; // Basic responsive

  return (
    <div className={`grid w-full max-w-6xl gap-4 p-4 ${gridCols}`}>
      <VideoTile
        stream={localStream}
        videoRef={localVideoRef}
        isLocal
        isMuted={isMicMuted} // Visual indicator only, actual mute handles by stream track
        name={userName}
      />
      {peerIds.map((id) => (
        <VideoTile
          key={id}
          stream={peers[id]}
          name={`User ${id.substr(0, 4)}`}
        />
      ))}
    </div>
  );
}
