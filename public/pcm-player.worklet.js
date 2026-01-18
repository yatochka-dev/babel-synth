// public/pcm-player-worklet.js

class Pcm16StereoPlayer extends AudioWorkletProcessor {
  constructor() {
    super();

    // Ring buffer storing float samples interleaved L,R
    // Size: ~2 seconds at 48kHz stereo => 48k * 2 * 2ch = 192k samples
    // We'll store interleaved floats, so capacity in float-samples.
    this.capacity = 192000;
    this.buffer = new Float32Array(this.capacity);
    this.writeIdx = 0;
    this.readIdx = 0;
    this.available = 0;

    this.port.onmessage = (e) => {
      const ab = e.data;
      if (!(ab instanceof ArrayBuffer)) return;

      // Expect PCM16 stereo interleaved: [L0,R0,L1,R1,...]
      const view = new DataView(ab);
      const nSamples = view.byteLength / 2; // int16 samples (interleaved)
      // We'll push as float32 into ring buffer
      for (let i = 0; i < nSamples; i++) {
        const s = view.getInt16(i * 2, true) / 32768;
        // if ring full, drop oldest to keep latency bounded
        if (this.available >= this.capacity) {
          this.readIdx = (this.readIdx + 1) % this.capacity;
          this.available--;
        }
        this.buffer[this.writeIdx] = s;
        this.writeIdx = (this.writeIdx + 1) % this.capacity;
        this.available++;
      }
    };
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const left = out[0];
    const right = out[1];

    // If the output is mono for some reason, just fill channel 0
    const hasStereo = out.length >= 2;

    const frames = left.length;

    // We need 2 samples per frame if stereo (L+R)
    for (let i = 0; i < frames; i++) {
      if (hasStereo) {
        // Need 2 samples available
        if (this.available >= 2) {
          const l = this.buffer[this.readIdx];
          this.readIdx = (this.readIdx + 1) % this.capacity;
          const r = this.buffer[this.readIdx];
          this.readIdx = (this.readIdx + 1) % this.capacity;
          this.available -= 2;

          left[i] = l;
          right[i] = r;
        } else {
          // underrun -> silence
          left[i] = 0;
          right[i] = 0;
        }
      } else {
        if (this.available >= 1) {
          const s = this.buffer[this.readIdx];
          this.readIdx = (this.readIdx + 1) % this.capacity;
          this.available -= 1;
          left[i] = s;
        } else {
          left[i] = 0;
        }
      }
    }

    return true;
  }
}

registerProcessor("pcm16-stereo-player", Pcm16StereoPlayer);
// a lot of AI code ^^^^^
