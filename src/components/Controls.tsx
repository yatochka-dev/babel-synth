interface ControlsProps {
  isMicMuted: boolean;
  isCameraOff: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onLeave: () => void;
}

export default function Controls({
  isMicMuted,
  isCameraOff,
  onToggleMic,
  onToggleCamera,
  onLeave,
}: ControlsProps) {
  return (
    <div className="fixed bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-4 rounded-full bg-black/60 px-6 py-3 backdrop-blur-md">
      <button
        onClick={onToggleMic}
        className={`rounded-full p-3 transition ${
          isMicMuted
            ? "bg-red-500 hover:bg-red-600"
            : "bg-white/20 hover:bg-white/30"
        }`}
        title={isMicMuted ? "Unmute" : "Mute"}
      >
        {isMicMuted ? "🔇" : "🎤"}
      </button>
      <button
        onClick={onToggleCamera}
        className={`rounded-full p-3 transition ${
          isCameraOff
            ? "bg-red-500 hover:bg-red-600"
            : "bg-white/20 hover:bg-white/30"
        }`}
        title={isCameraOff ? "Turn On Camera" : "Turn Off Camera"}
      >
        {isCameraOff ? "📷⃠" : "📷"}
      </button>
      <button
        onClick={onLeave}
        className="rounded-full bg-red-600 px-6 py-2 font-semibold text-white transition hover:bg-red-700"
      >
        Leave
      </button>
    </div>
  );
}
