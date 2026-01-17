import asyncio
import json
import os
import time
import traceback
from dataclasses import dataclass, field
from typing import Any

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types

# Audio specs (kept same)
SAMPLE_RATE = 48000

app = FastAPI()

# quick knobs (global mutable)
TICK_HZ = 8
TICK_INTERVAL = 1.0 / TICK_HZ
AUDIO_QUEUE_MAX_PER_CLIENT = 10
AUDIO_CHUNK_DRAIN_LIMIT = 12

BPM_MIN = 80
BPM_MAX = 120
BPM_CHANGE_THRESHOLD = 3
BPM_RESET_COOLDOWN_SEC = 2.5

RAW_KEYS = [
    "pinch",
    "handOpen",
    "handHeight",
    "smile",
    "tension",
    "shoulderWidth",
    "armRaise",
]

# debug mode toggle
DEBUG = True


def _clamp01(x):
    return 0.0 if x < 0.0 else 1.0 if x > 1.0 else x


def _clamp(x, lo, hi):
    return lo if x < lo else hi if x > hi else x


def _now_s():
    return time.time()


# minimal data models, less typing for speed
@dataclass
class ClientConn:
    ws: WebSocket
    send_audio_q: asyncio.Queue = field(
        default_factory=lambda: asyncio.Queue(maxsize=AUDIO_QUEUE_MAX_PER_CLIENT)
    )
    latest_raw: dict = field(default_factory=dict)
    last_seen: float = field(default_factory=_now_s)


@dataclass
class Room:
    room_id: str
    clients: dict = field(default_factory=dict)
    merged_raw: dict = field(default_factory=lambda: {k: 0.0 for k in RAW_KEYS})
    lyria_audio_in_q: asyncio.Queue = field(
        default_factory=lambda: asyncio.Queue(maxsize=200)
    )
    lyria_tick_task: asyncio.Task = None
    lyria_session_task: asyncio.Task = None
    lyria_session_ready: asyncio.Event = field(default_factory=asyncio.Event)
    lyria_stop: asyncio.Event = field(default_factory=asyncio.Event)
    lyria_session: Any = None
    last_sent_config: dict = field(default_factory=dict)
    last_bpm: int = 90
    last_bpm_reset_at: float = 0.0


# global rooms map
ROOMS = {}

# Gemini client - env var recommended
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY and DEBUG:
    print("[WARN] GEMINI_API_KEY not set; Lyria connect will fail later")

# create even if key None - will raise at call time
genai_client = genai.Client(
    api_key=GEMINI_API_KEY, http_options={"api_version": "v1alpha"}
)


# ----------------------------
# Merge helpers (simple)
# ----------------------------
def sanitize_raw_payload(p):
    out = {}
    for k in RAW_KEYS:
        if k in p:
            try:
                out[k] = _clamp01(float(p[k]))
            except Exception:
                # ignore bad values
                continue
    return out


def merge_latest_raw(room: Room):
    # if empty keep previous merged
    if not room.clients:
        return room.merged_raw
    acc = {k: 0.0 for k in RAW_KEYS}
    wsum = 0.0
    t = _now_s()
    for c in room.clients.values():
        age = t - c.last_seen
        if age <= 0.5:
            w = 1.0
        elif age >= 3.0:
            w = 0.0
        else:
            w = 1.0 - (age - 0.5) / (3.0 - 0.5)
        if w <= 0:
            continue
        for k in RAW_KEYS:
            acc[k] += w * float(c.latest_raw.get(k, 0.0))
        wsum += w
    if wsum <= 1e-6:
        return room.merged_raw
    return {k: acc[k] / wsum for k in RAW_KEYS}


def build_lyria_prompts_and_config(merged_raw):
    # small doc: maps 0..1 to prompts & LiveMusicGenerationConfig
    pinch = _clamp01(merged_raw.get("pinch", 0.0))
    hand_open = _clamp01(merged_raw.get("handOpen", 0.0))
    hand_h = _clamp01(merged_raw.get("handHeight", 0.0))
    smile = _clamp01(merged_raw.get("smile", 0.0))
    tension = _clamp01(merged_raw.get("tension", 0.0))
    shoulder = _clamp01(merged_raw.get("shoulderWidth", 0.0))
    arm = _clamp01(merged_raw.get("armRaise", 0.0))

    bpm = int(round(BPM_MIN + (BPM_MAX - BPM_MIN) * tension))
    bpm = int(_clamp(bpm, 60, 200))

    density = _clamp(0.15 + 0.45 * hand_open, 0.0, 1.0)
    brightness = _clamp(0.20 + 0.60 * hand_h, 0.0, 1.0)
    guidance = _clamp(3.5 + 1.2 * arm, 0.0, 6.0)

    minor_w = 0.9 * (1.0 - smile)
    major_w = 0.9 * smile
    motif_w = 0.7 * pinch
    improv_w = 0.7 * (1.0 - pinch)
    wide_w = 0.5 * shoulder
    intimate_w = 0.5 * (1.0 - shoulder)
    dissonant_w = 0.7 * tension
    consonant_w = 0.7 * (1.0 - tension)

    prompts_raw = [
        (
            "dialogue underscore, minimalist chamber trio, legato piano, warm bass, lyrical violin, no percussion, no drums",
            1.6,
        ),
        ("slow harmonic rhythm, gentle phrasing, sustained notes", 0.7),
        ("minor tonality, bittersweet harmony, soft dissonance, suspensions", minor_w),
        ("major tonality, warm consonant harmony, hopeful", major_w),
        ("clear repeating motif, thematic, consistent", motif_w),
        ("wandering melody, subtle variation, improvisational", improv_w),
        ("more dissonance, unresolved suspensions, emotional tension", dissonant_w),
        ("more consonance, resolved cadences, calm", consonant_w),
        ("spacious room reverb, wide soundstage", wide_w),
        ("intimate close-mic trio, small room", intimate_w),
    ]

    prompts = []
    for text, w in prompts_raw:
        # tiny threshold
        if w > 0.05:
            try:
                prompts.append(types.WeightedPrompt(text=text, weight=float(w)))
            except Exception:
                # be forgiving if types not available in this genai package version
                prompts.append(types.WeightedPrompt(text=text, weight=float(w)))

    cfg = types.LiveMusicGenerationConfig(
        bpm=int(bpm),
        guidance=float(guidance),
        density=float(density),
        brightness=float(brightness),
        temperature=1.1,
        top_k=40,
        mute_drums=True,
        mute_bass=False,
        only_bass_and_drums=False,
    )
    return prompts, cfg, bpm


async def audio_sender_loop(client: ClientConn):
    # keep sending until disconnected; drop exceptions and exit
    while True:
        try:
            chunk = await client.send_audio_q.get()
            await client.ws.send_bytes(chunk)
        except asyncio.CancelledError:
            break
        except Exception:
            if DEBUG:
                print(
                    "[WARN] audio_sender_loop error, closing sender:",
                    traceback.format_exc(),
                )
            break


def enqueue_audio(client: ClientConn, chunk: bytes):
    # drop oldest if full
    if client.send_audio_q.full():
        try:
            _ = client.send_audio_q.get_nowait()
        except Exception:
            pass
    try:
        client.send_audio_q.put_nowait(chunk)
    except Exception:
        pass


async def broadcast_audio(room: Room, chunk: bytes):
    # naive fanout
    for c in list(room.clients.values()):
        enqueue_audio(c, chunk)


async def lyria_session_loop(room: Room):
    # manages genai live session and fills room.lyria_audio_in_q
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY missing")

    room.lyria_session_ready.clear()
    room.lyria_stop.clear()
    if DEBUG:
        print("[INFO] starting lyria_session_loop for", room.room_id)
    try:
        # NOTE: this relies on genai_client.aio API, which may raise if not available
        async with genai_client.aio.live.music.connect(
            model="models/lyria-realtime-exp"
        ) as session:
            room.lyria_session = session
            room.lyria_session_ready.set()
            if DEBUG:
                print("[INFO] lyria session connected for", room.room_id)
            while not room.lyria_stop.is_set():
                async for message in session.receive():
                    if room.lyria_stop.is_set():
                        break
                    sc = getattr(message, "server_content", None)
                    if not sc:
                        continue
                    chunks = getattr(sc, "audio_chunks", None)
                    if not chunks:
                        continue
                    for ch in chunks:
                        pcm = getattr(ch, "data", None)
                        if not pcm:
                            continue
                        # drop oldest if full
                        if room.lyria_audio_in_q.full():
                            try:
                                _ = room.lyria_audio_in_q.get_nowait()
                            except Exception:
                                pass
                        try:
                            room.lyria_audio_in_q.put_nowait(pcm)
                        except Exception:
                            pass
                    # yield to event loop
                    await asyncio.sleep(0)
    except asyncio.CancelledError:
        # usual shutdown path
        raise
    except Exception:
        if DEBUG:
            print("[ERROR] lyria_session_loop crashed:", traceback.format_exc())
    finally:
        room.lyria_session = None
        room.lyria_session_ready.clear()
        if DEBUG:
            print("[INFO] lyria_session_loop ended for", room.room_id)


async def ensure_lyria_session(room: Room):
    # start the session task if needed and wait for ready
    if room.lyria_session_task is None or room.lyria_session_task.done():
        room.lyria_session_task = asyncio.create_task(lyria_session_loop(room))
    await room.lyria_session_ready.wait()


async def tick_loop(room: Room):
    # start session and do initial set/play
    await ensure_lyria_session(room)
    session = room.lyria_session

    prompts, cfg, bpm = build_lyria_prompts_and_config(room.merged_raw)
    try:
        await session.set_weighted_prompts(prompts=prompts)
        await session.set_music_generation_config(config=cfg)
        await session.play()
    except Exception:
        if DEBUG:
            print("[WARN] initial session ops failed (maybe session is flaky)")

    room.last_bpm = bpm
    room.last_bpm_reset_at = _now_s()
    if DEBUG:
        print("[INFO] tick_loop started for", room.room_id, "initial bpm", bpm)

    while True:
        tick_start = _now_s()

        # if session died, restart & re-init
        if room.lyria_session is None:
            await ensure_lyria_session(room)
            session = room.lyria_session
            prompts, cfg, bpm = build_lyria_prompts_and_config(room.merged_raw)
            try:
                await session.set_weighted_prompts(prompts=prompts)
                await session.set_music_generation_config(config=cfg)
                await session.play()
            except Exception:
                if DEBUG:
                    print("[WARN] re-init after session reconnect failed")

            room.last_bpm = bpm
            room.last_bpm_reset_at = _now_s()

        # merge inputs
        room.merged_raw = merge_latest_raw(room)
        prompts, cfg, bpm = build_lyria_prompts_and_config(room.merged_raw)

        # apply new prompts/config each tick (docs say full config to avoid partial resets)
        try:
            await session.set_weighted_prompts(prompts=prompts)
            await session.set_music_generation_config(config=cfg)
        except Exception:
            if DEBUG:
                print("[WARN] failed to apply prompts/config:", traceback.format_exc())

        # bpm hard reset policy
        tnow = _now_s()
        if (
            abs(bpm - room.last_bpm) >= BPM_CHANGE_THRESHOLD
            and (tnow - room.last_bpm_reset_at) >= BPM_RESET_COOLDOWN_SEC
        ):
            try:
                await session.reset_context()
                room.last_bpm_reset_at = tnow
                room.last_bpm = bpm
                if DEBUG:
                    print(
                        "[INFO] reset_context triggered for", room.room_id, "bpm", bpm
                    )
            except Exception:
                if DEBUG:
                    print("[WARN] reset_context failed")

        # drain audio and broadcast (limit per tick)
        drained = 0
        while drained < AUDIO_CHUNK_DRAIN_LIMIT:
            try:
                pcm = room.lyria_audio_in_q.get_nowait()
            except Exception:
                break
            try:
                await broadcast_audio(room, pcm)
            except Exception:
                if DEBUG:
                    print("[WARN] broadcast failed", traceback.format_exc())
            drained += 1

        # tick pacing
        elapsed = _now_s() - tick_start
        sleep_for = TICK_INTERVAL - elapsed
        if sleep_for > 0:
            await asyncio.sleep(sleep_for)
        else:
            await asyncio.sleep(0)


def get_room(room_id: str) -> Room:
    r = ROOMS.get(room_id)
    if not r:
        r = Room(room_id=room_id)
        ROOMS[room_id] = r
    return r


def ensure_room_tasks(room: Room):
    if room.lyria_tick_task is None or room.lyria_tick_task.done():
        room.lyria_tick_task = asyncio.create_task(tick_loop(room))


async def shutdown_room(room: Room):
    # stop tick and session loops
    if room.lyria_tick_task and not room.lyria_tick_task.done():
        room.lyria_tick_task.cancel()
    room.lyria_stop.set()
    if room.lyria_session_task and not room.lyria_session_task.done():
        room.lyria_session_task.cancel()
    ROOMS.pop(room.room_id, None)
    if DEBUG:
        print("[INFO] room shutdown", room.room_id)


@app.websocket("/ws/{room_id}/{user_id}")
async def ws_room(websocket: WebSocket, room_id: str, user_id: str):
    # accept and register client
    await websocket.accept()
    room = get_room(room_id)
    client = ClientConn(ws=websocket)
    room.clients[user_id] = client
    ensure_room_tasks(room)
    sender_task = asyncio.create_task(audio_sender_loop(client))
    if DEBUG:
        print("[INFO] ws connected", room_id, user_id)
    try:
        while True:
            # expecting JSON text messages
            try:
                txt = await websocket.receive_text()
            except WebSocketDisconnect:
                break
            except Exception:
                if DEBUG:
                    print("[WARN] receive_text failed:", traceback.format_exc())
                break

            try:
                data = json.loads(txt)
            except Exception:
                # ignore bad msgs
                continue

            typ = data.get("type")
            if typ == "raw":
                raw = sanitize_raw_payload(data)
                if raw:
                    client.latest_raw.update(raw)
                    client.last_seen = _now_s()
            elif typ == "ping":
                client.last_seen = _now_s()
                try:
                    await websocket.send_text('{"type":"pong"}')
                except Exception:
                    pass
            else:
                # ignore other messages for now
                pass

    finally:
        # cleanup
        try:
            sender_task.cancel()
        except Exception:
            pass
        room.clients.pop(user_id, None)
        if DEBUG:
            print("[INFO] ws disconnected", room_id, user_id)
        if not room.clients:
            # last client left -> tear down
            try:
                await shutdown_room(room)
            except Exception:
                if DEBUG:
                    print("[WARN] shutdown failed", traceback.format_exc())


if __name__ == "__main__":
    # run local for hack demo
    uvicorn.run("main:app", host="127.0.0.1", port=5000, log_level="info")
