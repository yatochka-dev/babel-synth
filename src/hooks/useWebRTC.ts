import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

const STUN_SERVERS = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"],
    },
  ],
};

interface Peer {
  connection: RTCPeerConnection;
  stream?: MediaStream;
}

interface UserConnectedPayload {
  userId: string;
  name: string;
}

interface OfferPayload {
  sdp: RTCSessionDescriptionInit;
  senderUserId: string;
}

interface AnswerPayload {
  sdp: RTCSessionDescriptionInit;
  senderUserId: string;
}

interface IceCandidatePayload {
  candidate: RTCIceCandidateInit;
  senderUserId: string;
}

export function useWebRTC(roomId: string, name: string) {
  const [userId, setUserId] = useState("");
  const socketRef = useRef<Socket | null>(null);
  const peersRef = useRef<Record<string, Peer>>({});
  // Queue for candidates arriving before remote description is set
  const candidatesQueue = useRef<Record<string, RTCIceCandidateInit[]>>({});

  const [peers, setPeers] = useState<Record<string, MediaStream>>({});
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // Initialize Socket and Local Stream
  useEffect(() => {
    const socket = io();
    socketRef.current = socket;

    const initMediaAndJoin = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Media devices not supported (HTTPS required?)");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        setLocalStream(stream);
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Failed to get local stream", err);
        setError(
          "Camera/Mic access failed. You can see others but they can't see you.",
        );
      } finally {
        // Join Room regardless of media success
                if (socket.id) {
                  setUserId(socket.id);
                  socket.emit("join-room", { roomId, name });
                } else {
                  socket.on("connect", () => {
                    if (socket.id) {
                      setUserId(socket.id);
                      socket.emit("join-room", { roomId, name });
                    }
                  });
                }      }
    };

    void initMediaAndJoin();

    // Socket Events
    socket.on(
      "user-connected",
      async ({
        userId: remoteUserId,
        name: remoteName,
      }: UserConnectedPayload) => {
        console.log(`User connected: ${remoteName} (${remoteUserId})`);
        const { connection } = createPeerConnection(
          remoteUserId,
          socket,
          localStreamRef.current,
        );
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        socket.emit("offer", { sdp: offer, targetUserId: remoteUserId });
      },
    );

    socket.on("offer", async ({ sdp, senderUserId }: OfferPayload) => {
      console.log(`Received Offer from ${senderUserId}`);
      const { connection } = createPeerConnection(
        senderUserId,
        socket,
        localStreamRef.current,
      );

      try {
        await connection.setRemoteDescription(new RTCSessionDescription(sdp));
        // Process queued candidates
        const queue = candidatesQueue.current[senderUserId];
        if (queue) {
          console.log(
            `Processing ${queue.length} queued candidates for ${senderUserId}`,
          );
          for (const candidate of queue) {
            await connection.addIceCandidate(new RTCIceCandidate(candidate));
          }
          delete candidatesQueue.current[senderUserId];
        }

        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        socket.emit("answer", { sdp: answer, targetUserId: senderUserId });
      } catch (e) {
        console.error("Error handling offer:", e);
      }
    });

    socket.on("answer", async ({ sdp, senderUserId }: AnswerPayload) => {
      console.log(`Received Answer from ${senderUserId}`);
      const peer = peersRef.current[senderUserId];
      if (peer) {
        try {
          await peer.connection.setRemoteDescription(
            new RTCSessionDescription(sdp),
          );
          // Process queued candidates
          const queue = candidatesQueue.current[senderUserId];
          if (queue) {
            console.log(
              `Processing ${queue.length} queued candidates for ${senderUserId}`,
            );
            for (const candidate of queue) {
              await peer.connection.addIceCandidate(
                new RTCIceCandidate(candidate),
              );
            }
            delete candidatesQueue.current[senderUserId];
          }
        } catch (e) {
          console.error("Error handling answer:", e);
        }
      }
    });

    socket.on(
      "ice-candidate",
      async ({ candidate, senderUserId }: IceCandidatePayload) => {
        const peer = peersRef.current[senderUserId];
        if (peer?.connection.remoteDescription) {
          try {
            await peer.connection.addIceCandidate(
              new RTCIceCandidate(candidate),
            );
          } catch (e) {
            console.error("Error adding ice candidate:", e);
          }
      } else {
        // Queue candidate
        console.log(`Queueing candidate for ${senderUserId}`);
        (candidatesQueue.current[senderUserId] ??= []).push(candidate);
      }
    });

    socket.on("user-disconnected", ({ userId }: { userId: string }) => {
      console.log(`User disconnected: ${userId}`);
      if (candidatesQueue.current[userId]) {
        delete candidatesQueue.current[userId];
      }
      if (peersRef.current[userId]) {
        peersRef.current[userId]?.connection.close();
        delete peersRef.current[userId];
        setPeers((prev) => {
          const newPeers = { ...prev };
          delete newPeers[userId];
          return newPeers;
        });
      }
    });

    return () => {
      socket.disconnect();
      // localStream?.getTracks().forEach((track) => track.stop()); // Don't stop tracks on unmount to survive Strict Mode
    };
  }, [roomId, name]); // Run once on mount (with deps)

  // Helper: Create Peer Connection
  const createPeerConnection = (
    targetUserId: string,
    socket: Socket,
    stream: MediaStream | null,
  ) => {
    // If already exists, return it (shouldn't happen often in this flow but good for safety)
    if (peersRef.current[targetUserId]) return peersRef.current[targetUserId];

    const pc = new RTCPeerConnection(STUN_SERVERS);

    // Add local tracks
    if (stream) {
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("ice-candidate", {
          candidate: event.candidate,
          targetUserId,
        });
      }
    };

    // Handle incoming stream
    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      if (remoteStream) {
        peersRef.current[targetUserId]!.stream = remoteStream;
        setPeers((prev) => ({ ...prev, [targetUserId]: remoteStream }));
      }
    };

    peersRef.current[targetUserId] = { connection: pc };

    // Create Offer (if we are the initiator, effectively - simplified here)
    // Actually, the "user-connected" event triggers the offer.
    // We need to know if we are creating an offer.
    // In this logic: "user-connected" -> existing user creates offer for new user.
    // This function is called by "user-connected" (we create offer) AND by "offer" (we receive offer).
    // We need to differentiate or let the caller handle the specific offer/answer logic.
    // Refactoring slightly for clarity inside this function isn't easy without splitting.
    // So "createPeerConnection" just sets up the object. The caller does createOffer/Answer.

    // BUT: "user-connected" caller needs to create offer immediately.
    // Let's modify "user-connected" handler above to do the offer creation.

    return { connection: pc };
  };

  // Logic adjustment for "user-connected" in useEffect:
  // createPeerConnection(...)
  // const offer = await pc.createOffer();
  // ...
  // Wait, I can't await inside the sync helper easily if I don't split it.
  // I will leave createPeerConnection as a setup helper.

  // Re-implementing parts of the useEffect for clarity/correctness on the fly:
  // "user-connected": Existing user sees new user. Existing user creates OFFER.
  // "offer": New user receives OFFER from Existing user. New user creates ANSWER.

  // Let's rewrite the createPeerConnection to be purely setup.
  // And fix the useEffect logic.

  // Toggle Media
  const toggleMic = () => {
    if (localStream) {
      localStream
        .getAudioTracks()
        .forEach((track) => (track.enabled = !track.enabled));
      setIsMicMuted(!isMicMuted);
    }
  };

  const toggleCamera = () => {
    if (localStream) {
      localStream
        .getVideoTracks()
        .forEach((track) => (track.enabled = !track.enabled));
      setIsCameraOff(!isCameraOff);
    }
  };

  return {
    localStream,
    localVideoRef,
    peers,
    toggleMic,
    toggleCamera,
    isMicMuted,
    isCameraOff,
    userId,
    error,
  };
}
