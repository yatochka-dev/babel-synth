import asyncio
import os
import traceback

from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()
API_KEY = os.getenv("GEMINI_API_KEY")
client = genai.Client(api_key=API_KEY, http_options={"api_version": "v1alpha"})


def clamp(x, lo, hi):
    return lo if x < lo else hi if x > hi else x


def build_config(raw):
    p = lambda k: clamp(float(raw.get(k, 0)), 0, 1)

    smile = p("smile")
    tension = p("tension")
    arm = p("armRaise")
    hand_open = p("handOpen")
    pinch = p("pinch")
    shoulder = p("shoulderWidth")

    bpm = int(clamp(round(68 + 12 * arm + 40 * tension), 60, 120))
    brightness = clamp(0.18 + 0.72 * smile, 0.12, 0.90)
    density = clamp(0.06 + 0.16 * hand_open + 0.06 * tension, 0.05, 0.30)
    temperature = clamp(1.0 + 0.6 * tension, 0.95, 1.7)
    guidance = clamp(2.0 + 0.6 * (1 - tension) + 0.2 * pinch, 1.8, 2.6)
    top_k = int(clamp(round(30 + 35 * tension), 25, 70))

    drums = tension > 0.75 and arm > 0.75

    if drums:
        base = "ambient underscore, sparse, long notes, leave space, no bass"
    else:
        base = "ambient underscore, single instrument, sparse, long notes, leave space, no drums, no percussion, no bass"

    mood = (
        "bright, warm, major, open, uplifting, clear tone"
        if smile >= 0.55
        else "darker, minor, restrained, gentle dissonance, emotional"
    )
    space = "wide spacious reverb" if shoulder > 0.5 else "dry close intimate"

    prompts = [
        types.WeightedPrompt(text=base, weight=1.6),
        types.WeightedPrompt(text=mood, weight=0.9),
        types.WeightedPrompt(text=space, weight=0.3),
    ]

    cfg = types.LiveMusicGenerationConfig(
        bpm=bpm,
        guidance=guidance,
        density=density,
        brightness=brightness,
        temperature=temperature,
        top_k=top_k,
        mute_drums=not drums,
        mute_bass=True,
    )

    return prompts, cfg, bpm


async def run_session(room):
    if not API_KEY:
        raise RuntimeError("no api key")

    room.lyria_ready.clear()
    room.lyria_stop.clear()

    try:
        async with client.aio.live.music.connect(
            model="models/lyria-realtime-exp"
        ) as sess:
            room.lyria_sess = sess
            room.lyria_ready.set()

            while not room.lyria_stop.is_set():
                async for msg in sess.receive():
                    if room.lyria_stop.is_set():
                        break
                    sc = getattr(msg, "server_content", None)
                    if not sc:
                        continue
                    chunks = getattr(sc, "audio_chunks", None)
                    if not chunks:
                        continue
                    for ch in chunks:
                        pcm = getattr(ch, "data", None)
                        if pcm:
                            if room.audio_q.full():
                                try:
                                    room.audio_q.get_nowait()
                                except:
                                    pass
                            try:
                                room.audio_q.put_nowait(pcm)
                            except:
                                pass
                    await asyncio.sleep(0)
    except asyncio.CancelledError:
        raise
    except:
        print(f"[ERR] lyria crashed: {traceback.format_exc()}")
    finally:
        room.lyria_sess = None
        room.lyria_ready.clear()


async def ensure_session(room):
    if room.lyria_task is None or room.lyria_task.done():
        room.lyria_task = asyncio.create_task(run_session(room))
    await room.lyria_ready.wait()
