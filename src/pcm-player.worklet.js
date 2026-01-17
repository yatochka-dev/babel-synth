class PCMPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.readIndex = 0;
    this.current = null;

    this.port.onmessage = (e) => {
      // e.data is Float32Array
      this.queue.push(e.data);
    };
  }

  process(inputs, outputs) {
    const out = outputs[0][0];
    let i = 0;

    while (i < out.length) {
      if (!this.current || this.readIndex >= this.current.length) {
        this.current = this.queue.shift() || null;
        this.readIndex = 0;
        if (!this.current) {
          // underrun -> silence
          while (i < out.length) out[i++] = 0;
          return true;
        }
      }
      out[i++] = this.current[this.readIndex++];
    }
    return true;
  }
}

registerProcessor("pcm-player", PCMPlayer);
