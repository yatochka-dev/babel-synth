import math
import struct

SAMPLE_RATE = 48000
FRAME_MS = 20
SAMPLES_PER_FRAME = SAMPLE_RATE * FRAME_MS // 1000

_phase = 0.0


def gen_sine_frame(freq_hz: float, gain: float = 0.05) -> bytes:
    global _phase
    out = bytearray()
    phase_inc = 2.0 * math.pi * freq_hz / SAMPLE_RATE
    for _ in range(SAMPLES_PER_FRAME):
        s = math.sin(_phase) * gain
        out += struct.pack("<f", s)  # float32 LE
        _phase += phase_inc
        if _phase > 2.0 * math.pi:
            _phase -= 2.0 * math.pi
    return bytes(out)
