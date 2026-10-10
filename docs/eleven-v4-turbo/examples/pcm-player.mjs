// Browser helper for mono signed 16-bit little-endian RAW PCM.
// The caller owns an authenticated application relay and current turn identity.
export class PcmPlayer {
  constructor({ sampleRate = 24000, scheduleAheadSeconds = 0.03 } = {}) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('Invalid sample rate.');
    if (!Number.isFinite(scheduleAheadSeconds) || scheduleAheadSeconds < 0) throw new Error('Invalid scheduling cushion.');
    this.context = new AudioContext();
    this.sampleRate = sampleRate;
    this.scheduleAheadSeconds = scheduleAheadSeconds;
    this.turnId = null;
    this.nextStart = 0;
    this.sources = new Set();
    this.pendingByte = null;
  }

  async resume() {
    await this.context.resume();
  }

  beginTurn(turnId) {
    if (turnId === null || turnId === undefined) throw new Error('A turn ID is required.');
    this.stop();
    this.turnId = turnId;
  }

  enqueueBase64(encoded, turnId) {
    if (this.turnId === null || turnId !== this.turnId) return false;
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return this.enqueueBytes(bytes, turnId);
  }

  enqueueBytes(bytes, turnId) {
    if (this.turnId === null || turnId !== this.turnId) return false;
    if (!(bytes instanceof Uint8Array)) throw new Error('PCM must be a Uint8Array.');
    if (this.pendingByte !== null) {
      const combined = new Uint8Array(bytes.length + 1);
      combined[0] = this.pendingByte;
      combined.set(bytes, 1);
      bytes = combined;
      this.pendingByte = null;
    }
    if (bytes.length % 2) this.pendingByte = bytes[bytes.length - 1];
    const sampleCount = Math.floor(bytes.length / 2);
    if (!sampleCount) return true;
    const buffer = this.context.createBuffer(1, sampleCount, this.sampleRate);
    const samples = buffer.getChannelData(0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
    for (let i = 0; i < sampleCount; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
    };
    const startAt = Math.max(this.nextStart, this.context.currentTime + this.scheduleAheadSeconds);
    this.sources.add(source);
    source.start(startAt);
    this.nextStart = startAt + buffer.duration;
    return true;
  }

  get queuedSeconds() {
    return Math.max(0, this.nextStart - this.context.currentTime);
  }

  stop() {
    this.turnId = null;
    for (const source of this.sources) {
      try { source.stop(); } catch { /* An already ended source needs no stop. */ }
      source.disconnect();
    }
    this.sources.clear();
    this.pendingByte = null;
    this.nextStart = this.context.currentTime;
  }

  async dispose() {
    this.stop();
    await this.context.close();
  }
}
