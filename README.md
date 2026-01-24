# Babel Synth - Technical Architecture

Babel Synth is an experimental project made during a 2 day hackathon competition, combining **real-time computer vision**, **generative music**, and **peer-to-peer voice chat**.
Two users join a room, their body/face motion is tracked live, and those features drive an AI music model that streams raw audio back into the browser.

## System Overview

* **Next.js 15 frontend** for room UI + vision + audio playback
* **FastAPI music server** for feature ingestion + generative audio streaming
* **WebRTC voice chat** between peers (2-person rooms only)
* **MediaPipe → features → Lyria → PCM audio → AudioWorklet playback**

---

## Main Components

### Frontend (Next.js App Router)

* `/` creates or joins rooms
* `/room/[id]` runs the full interactive pipeline (camera → vision → audio → WebRTC)

The `Room` client component orchestrates:

* calibration + feature state
* WebSocket streaming to the music server
* real-time PCM playback

---

### Vision Pipeline (MediaPipe Tasks Vision)

* Camera stream acquired via `useUserVideo`
* `useVision` runs hand/face/pose landmark models
* Outputs smoothed, normalized motion features:

Examples: `smile`, `pinch`, `handOpen`, `armRaise`, etc.

---

### Music Streaming (WebSocket + AudioWorklet)

* `useRoomRawSender` sends feature JSON to FastAPI at a fixed tick rate
* Server returns raw **PCM audio frames**
* `useRoomAudioPlayer` plays audio in real time using an `AudioWorklet`

This avoids encoded audio formats and keeps latency low.

---

### Voice Chat (WebRTC + SSE Signaling)

* `VoiceP2P` establishes a direct 2-peer `RTCPeerConnection`
* Microphone tracks stream peer-to-peer
* Signaling is handled through:

  * **SSE `/api/signal`** (receive)
  * **POST `/api/signal`** (send)

Room join logic enforces a strict two-user limit.

---

### Music Server (FastAPI + Google GenAI Lyria)

* `/ws/{room}/{user}` WebSocket gateway
* Per-room runtime merges feature streams from both clients
* Features are mapped into weighted prompts/config for **Lyria realtime**
* Generated audio is streamed back as PCM chunks to all peers

---

## End-to-End Data Flow

1. User joins `/room/[id]`
2. MediaPipe extracts motion + expression features
3. Feature state is streamed to FastAPI via WebSocket
4. Lyria generates music conditioned on live movement
5. PCM audio is streamed back + played via AudioWorklet
6. WebRTC voice runs in parallel, SSE handles signaling

---

## Key Technologies

* **Next.js 15 + React 19**
* **MediaPipe Tasks Vision**
* **FastAPI + WebSockets**
* **Google GenAI Lyria (realtime generative audio)**
* **WebRTC (2-peer voice)**
* **SSE signaling layer**
* **AudioWorklet PCM playback**
