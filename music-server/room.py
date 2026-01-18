import asyncio
import json
import time
import traceback

from lyria import build_config, ensure_session

RAW_KEYS = [
    "pinch",
    "handOpen",
    "handHeight",
    "smile",
    "tension",
    "shoulderWidth",
    "armRaise",
]
TICK_HZ = 8
BPM_THRESHOLD = 3
BPM_COOLDOWN = 2.5

ROOMS = {}


class Client:
    def __init__(self, ws):
        self.ws = ws
        self.audio_q = asyncio.Queue(maxsize=10)
        self.raw = {}
        self.last_seen = time.time()


class Room:
    def __init__(self, rid):
        self.rid = rid
        self.clients = {}
        self.merged = {k: 0.0 for k in RAW_KEYS}
        self.audio_q = asyncio.Queue(maxsize=200)
        self.tick_task = None
        self.lyria_task = None
        self.lyria_ready = asyncio.Event()
        self.lyria_stop = asyncio.Event()
        self.lyria_sess = None
        self.last_bpm = 90
        self.bpm_reset_at = 0


def get_room(rid):
    if rid not in ROOMS:
        ROOMS[rid] = Room(rid)
    return ROOMS[rid]


def sanitize(data):
    out = {}
    for k in RAW_KEYS:
        if k in data:
            try:
                v = float(data[k])
                out[k] = max(0, min(1, v))
            except:
                pass
    return out


def merge_raw(room):
    if not room.clients:
        return room.merged
    acc = {k: 0.0 for k in RAW_KEYS}
    wsum = 0
    now = time.time()
    for c in room.clients.values():
        age = now - c.last_seen
        if age < 0.5:
            w = 1
        elif age > 3:
            w = 0
        else:
            w = 1 - (age - 0.5) / 2.5
        if w <= 0:
            continue
        for k in RAW_KEYS:
            acc[k] += w * c.raw.get(k, 0)
        wsum += w
    if wsum < 0.001:
        return room.merged
    return {k: acc[k] / wsum for k in RAW_KEYS}


async def broadcast(room, chunk):
    for c in list(room.clients.values()):
        if c.audio_q.full():
            try:
                c.audio_q.get_nowait()
            except:
                pass
        try:
            c.audio_q.put_nowait(chunk)
        except:
            pass


async def tick_loop(room):
    await ensure_session(room)
    sess = room.lyria_sess

    prompts, cfg, bpm = build_config(room.merged)
    try:
        await sess.set_weighted_prompts(prompts=prompts)
        await sess.set_music_generation_config(config=cfg)
        await sess.play()
    except:
        pass

    room.last_bpm = bpm
    room.bpm_reset_at = time.time()

    while True:
        t0 = time.time()

        if room.lyria_sess is None:
            await ensure_session(room)
            sess = room.lyria_sess
            prompts, cfg, bpm = build_config(room.merged)
            try:
                await sess.set_weighted_prompts(prompts=prompts)
                await sess.set_music_generation_config(config=cfg)
                await sess.play()
            except:
                pass
            room.last_bpm = bpm
            room.bpm_reset_at = time.time()

        room.merged = merge_raw(room)
        prompts, cfg, bpm = build_config(room.merged)

        try:
            await sess.set_weighted_prompts(prompts=prompts)
            await sess.set_music_generation_config(config=cfg)
        except:
            pass

        now = time.time()
        if (
            abs(bpm - room.last_bpm) >= BPM_THRESHOLD
            and (now - room.bpm_reset_at) >= BPM_COOLDOWN
        ):
            try:
                await sess.reset_context()
                room.bpm_reset_at = now
                room.last_bpm = bpm
            except:
                pass

        for _ in range(12):
            try:
                pcm = room.audio_q.get_nowait()
                await broadcast(room, pcm)
            except:
                break

        elapsed = time.time() - t0
        sleep = (1 / TICK_HZ) - elapsed
        await asyncio.sleep(max(0, sleep))


def start_room(room):
    if room.tick_task is None or room.tick_task.done():
        room.tick_task = asyncio.create_task(tick_loop(room))


async def stop_room(room):
    if room.tick_task and not room.tick_task.done():
        room.tick_task.cancel()
    room.lyria_stop.set()
    if room.lyria_task and not room.lyria_task.done():
        room.lyria_task.cancel()
    ROOMS.pop(room.rid, None)


async def sender_loop(client):
    while True:
        try:
            chunk = await client.audio_q.get()
            await client.ws.send_bytes(chunk)
        except asyncio.CancelledError:
            break
        except:
            break


async def handle_ws(ws, rid, uid):
    await ws.accept()
    room = get_room(rid)
    client = Client(ws)
    room.clients[uid] = client
    start_room(room)
    sender = asyncio.create_task(sender_loop(client))

    try:
        while True:
            try:
                txt = await ws.receive_text()
            except:
                break
            try:
                data = json.loads(txt)
            except:
                continue

            t = data.get("type")
            if t == "raw":
                raw = sanitize(data)
                if raw:
                    client.raw.update(raw)
                    client.last_seen = time.time()
            elif t == "ping":
                client.last_seen = time.time()
                try:
                    await ws.send_text('{"type":"pong"}')
                except:
                    pass
    finally:
        sender.cancel()
        room.clients.pop(uid, None)
        if not room.clients:
            await stop_room(room)
