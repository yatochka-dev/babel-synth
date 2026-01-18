"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Status = "idle" | "connecting" | "connected" | "error" | "full";

function uid() {
  return Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
}

async function postSignal(body: any) {
  await fetch("/api/signal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

export function VoiceP2P({ roomId }: { roomId: string }) {
  const peerId = useMemo(() => uid(), []);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const [muted, setMuted] = useState(false);
  const [localMonitor, setLocalMonitor] = useState(false);
  const [remoteAudioReceived, setRemoteAudioReceived] = useState(false);
  const [pcState, setPcState] = useState("new");

  const initiatorRef = useRef(false);
  const otherPeerRef = useRef<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);

  // audio elements
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const localAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    const cleanup = () => {
      try {
        esRef.current?.close();
      } catch {}
      esRef.current = null;

      try {
        pcRef.current?.close();
      } catch {}
      pcRef.current = null;

      try {
        localStreamRef.current?.getTracks().forEach((t) => t.stop());
      } catch {}
      localStreamRef.current = null;

      otherPeerRef.current = null;
      initiatorRef.current = false;

      setRemoteAudioReceived(false);
      setPcState("new");
    };

    const ensurePC = () => {
      if (pcRef.current) return pcRef.current;

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });

      pc.onconnectionstatechange = () => setPcState(pc.connectionState);
      pc.oniceconnectionstatechange = () => {
        // optional extra signal
      };

      pc.onicecandidate = (ev) => {
        if (!ev.candidate) return;
        const to = otherPeerRef.current;
        if (!to) return;

        void postSignal({
          room: roomId,
          from: peerId,
          to,
          type: "candidate",
          payload: ev.candidate,
        });
      };

      pc.ontrack = (ev) => {
        // Some browsers populate ev.streams, some don't. Handle both.
        const track = ev.track;
        if (track.kind !== "audio") return;

        setRemoteAudioReceived(true);

        const stream =
          ev.streams && ev.streams[0]
            ? ev.streams[0]
            : new MediaStream([track]);

        const el = remoteAudioRef.current;
        if (el) {
          // @ts-ignore
          el.srcObject = stream;
          el.muted = false;
          el.volume = 1;

          void el.play().catch(() => {});
        }
      };

      pcRef.current = pc;
      return pc;
    };

    const startLocalAudio = async () => {
      if (localStreamRef.current) return localStreamRef.current;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      localStreamRef.current = stream;

      // Attach to PC
      const pc = ensurePC();
      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }

      const localEl = localAudioRef.current;
      if (localEl) {
        // @ts-ignore
        localEl.srcObject = stream;
        localEl.muted = true; // keep muted by default to avoid feedback
      }

      return stream;
    };

    const makeOfferTo = async (toPeer: string) => {
      if (!toPeer) return;
      if (otherPeerRef.current && otherPeerRef.current !== toPeer) return; // 2-person

      otherPeerRef.current = toPeer;

      const pc = ensurePC();
      await startLocalAudio();

      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });
      await pc.setLocalDescription(offer);

      await postSignal({
        room: roomId,
        from: peerId,
        to: toPeer,
        type: "offer",
        payload: offer,
      });
    };

    const handleOffer = async (
      fromPeer: string,
      offer: RTCSessionDescriptionInit,
    ) => {
      otherPeerRef.current = fromPeer;

      const pc = ensurePC();
      await startLocalAudio();

      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await postSignal({
        room: roomId,
        from: peerId,
        to: fromPeer,
        type: "answer",
        payload: answer,
      });

      setStatus("connected");
    };

    const handleAnswer = async (answer: RTCSessionDescriptionInit) => {
      const pc = ensurePC();
      await pc.setRemoteDescription(answer);
      setStatus("connected");
    };

    const handleCandidate = async (candidate: RTCIceCandidateInit) => {
      const pc = ensurePC();
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        // ignore (race with remoteDescription)
      }
    };

    const boot = async () => {
      try {
        setStatus("connecting");
        setError(null);

        // 1) Open SSE signaling
        const es = new EventSource(
          `/api/signal?room=${encodeURIComponent(roomId)}&peer=${encodeURIComponent(peerId)}`,
        );
        esRef.current = es;

        es.onmessage = async (ev) => {
          if (cancelled) return;
          const msg = JSON.parse(ev.data);

          switch (msg.type) {
            case "peer-joined": {
              // If we're initiator, immediately offer to the new peer
              if (initiatorRef.current && !otherPeerRef.current) {
                await makeOfferTo(msg.from);
              } else {
                if (!otherPeerRef.current) otherPeerRef.current = msg.from;
              }
              break;
            }
            case "peer-left": {
              otherPeerRef.current = null;
              setRemoteAudioReceived(false);
              setStatus("connecting");
              break;
            }
            case "offer":
              await handleOffer(msg.from, msg.payload);
              break;
            case "answer":
              await handleAnswer(msg.payload);
              break;
            case "candidate":
              await handleCandidate(msg.payload);
              break;
            default:
              break;
          }
        };

        es.onerror = () => {
          if (!cancelled) {
            setStatus("error");
            setError("Signaling (SSE) failed. Refresh both tabs.");
          }
        };

        // 2) Join room (max 2)
        const jr = await fetch("/api/room/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room: roomId, peer: peerId }),
          cache: "no-store",
        });

        if (!jr.ok) {
          const txt = await jr.text().catch(() => "");
          if (jr.status === 403) {
            setStatus("full");
            setError("Room full (max 2).");
            return;
          }
          throw new Error(txt || `join failed: ${jr.status}`);
        }

        const { initiator, others } = (await jr.json()) as {
          initiator: boolean;
          others: string[];
        };

        initiatorRef.current = initiator;

        // 3) Start mic ASAP so user sees permission prompt and we can negotiate
        await startLocalAudio();

        // If I'm initiator and other already exists, offer now.
        if (initiator && others.length > 0) {
          await makeOfferTo(others[0]);
        } else {
          if (!initiator && others.length > 0) otherPeerRef.current = others[0];
        }
      } catch (e: any) {
        if (!cancelled) {
          setStatus("error");
          setError(e?.message ?? String(e));
        }
      }
    };

    void boot();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [peerId, roomId]);

  // Apply mute to local tracks
  useEffect(() => {
    const s = localStreamRef.current;
    if (!s) return;
    for (const t of s.getAudioTracks()) t.enabled = !muted;

    // user gesture helps autoplay; try replay remote
    if (remoteAudioRef.current)
      void remoteAudioRef.current.play().catch(() => {});
  }, [muted]);

  // Local monitor toggling (WARNING: use headphones)
  useEffect(() => {
    const el = localAudioRef.current;
    if (!el) return;
    el.muted = !localMonitor; // unmute local monitor when enabled
    if (localMonitor) void el.play().catch(() => {});
  }, [localMonitor]);

  const connected = status === "connected";
  const connecting = status === "connecting";

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-sm">P2P Voice:</span>

        <span
          className={
            connected
              ? "text-sm text-green-500"
              : connecting
                ? "text-sm text-yellow-500"
                : status === "full"
                  ? "text-sm text-orange-500"
                  : status === "error"
                    ? "text-sm text-red-500"
                    : "text-muted-foreground text-sm"
          }
        >
          {status}
        </span>

        <span className="text-muted-foreground ml-2 text-xs">
          pc: <span className="font-mono">{pcState}</span> • remoteAudio:{" "}
          <span className="font-mono">
            {remoteAudioReceived ? "yes" : "no"}
          </span>
        </span>

        {error && (
          <span className="ml-2 max-w-[420px] truncate text-xs text-red-500">
            {error}
          </span>
        )}

        <button
          className="ml-auto rounded-md border px-3 py-1 text-sm"
          onClick={() => setMuted(true)}
          disabled={!connected}
        >
          Mute
        </button>
        <button
          className="rounded-md border px-3 py-1 text-sm"
          onClick={() => setMuted(false)}
          disabled={!connected}
        >
          Unmute
        </button>

        <button
          className="rounded-md border px-3 py-1 text-sm"
          onClick={() => setLocalMonitor((v) => !v)}
          disabled={!connected}
          title="Use headphones. This will play your own mic back to you."
        >
          {localMonitor ? "Stop Monitor" : "Monitor"}
        </button>
      </div>

      {/* Remote audio output */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Local monitor output (same stream). Muted unless Monitor enabled */}
      <audio ref={localAudioRef} autoPlay playsInline muted />

      <div className="text-muted-foreground mt-2 text-xs">
        room: <span className="font-mono">{roomId}</span> • peer:{" "}
        <span className="font-mono">{peerId.slice(0, 8)}…</span> • mic:{" "}
        {muted ? "muted" : "live"}
      </div>
    </div>
  );
}
