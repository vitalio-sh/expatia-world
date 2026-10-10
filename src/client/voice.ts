export type TurnId = string | number;
export type SpeechLanguage = 'es' | 'en';
export interface VoiceCallbacks {
  onCaption?(text: string, turnId: TurnId): void;
  onTranscript?(text: string, final: boolean, turnId: TurnId): void;
  onStatus?(status: string, detail?: string): void;
  onTiming?(timing: Record<string, number>, turnId: TurnId): void;
  onState?(state: any): void;
  onAutoTranscript?(transcript: Transcript): void;
}
export interface Transcript { text: string; model: string; live: boolean; elapsedMs: number; turnId: TurnId }

/** One clock, mono PCM16LE at 24 kHz; sources are stopped and late turns rejected. */
export class PcmPlayer {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private turnId: TurnId | null = null;
  private nextStart = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private pendingByte: number | null = null;
  private firstScheduled = false;
  private muted = false;
  public underruns = 0;
  constructor(private onFirst?: (turnId: TurnId, at: number) => void) {}
  async unlock() {
    if (!this.context || this.context.state === 'closed') {
      const Constructor = window.AudioContext || (window as any).webkitAudioContext;
      this.context = new Constructor();
      this.gain = this.context!.createGain(); this.gain!.gain.value = this.muted ? 0 : .88; this.gain!.connect(this.context!.destination);
    }
    await this.context!.resume();
    return this.context!;
  }
  beginTurn(turnId: TurnId) { this.stop(); this.turnId = turnId; this.firstScheduled = false; this.underruns = 0; }
  enqueueBase64(encoded: string, turnId: TurnId): boolean {
    if (this.turnId !== turnId || !this.context || this.context.state !== 'running') return false;
    const binary = atob(encoded);
    let bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    if (this.pendingByte !== null) { const combined = new Uint8Array(bytes.length + 1); combined[0] = this.pendingByte; combined.set(bytes, 1); bytes = combined; this.pendingByte = null; }
    if (bytes.length % 2) this.pendingByte = bytes[bytes.length - 1];
    const samples = Math.floor(bytes.length / 2);
    if (!samples) return true;
    // A runaway provider cannot grow a minutes-long queue.
    if (this.queuedSeconds > 15) { this.stop(); return false; }
    const buffer = this.context.createBuffer(1, samples, 24_000);
    const data = buffer.getChannelData(0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, samples * 2);
    for (let i = 0; i < samples; i++) data[i] = view.getInt16(i * 2, true) / 32768;
    const source = this.context.createBufferSource(); source.buffer = buffer; source.connect(this.gain!);
    source.onended = () => { this.sources.delete(source); source.disconnect(); };
    if (this.firstScheduled && this.nextStart < this.context.currentTime) this.underruns++;
    const start = Math.max(this.nextStart, this.context.currentTime + .025);
    this.sources.add(source); source.start(start); this.nextStart = start + buffer.duration;
    if (!this.firstScheduled) { this.firstScheduled = true; this.onFirst?.(turnId, performance.now() + Math.max(0, start - this.context.currentTime) * 1000); }
    return true;
  }
  get queuedSeconds() { return this.context ? Math.max(0, this.nextStart - this.context.currentTime) : 0; }
  setMuted(muted: boolean) { this.muted = muted; if (this.gain) this.gain.gain.value = muted ? 0 : .88; }
  stop() {
    this.turnId = null;
    for (const source of this.sources) { try { source.stop(); } catch { /* ended */ } source.disconnect(); }
    this.sources.clear(); this.pendingByte = null; this.nextStart = this.context?.currentTime || 0;
  }
  async dispose() { this.stop(); if (this.context && this.context.state !== 'closed') await this.context.close(); this.context = null; }
}

function encode(bytes: Uint8Array): string {
  let binary = ''; for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192)); return btoa(binary);
}
function pcm16(samples: number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2), view = new DataView(bytes.buffer);
  samples.forEach((sample, i) => view.setInt16(i * 2, Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767), true)); return bytes;
}

export class RealtimeVoice {
  public readonly player: PcmPlayer;
  private socket: WebSocket | null = null;
  private sessionId = '';
  private currentTurn: TurnId | null = null;
  private connectionPromise: Promise<void> | null = null;
  private recording: { stream: MediaStream; source: MediaStreamAudioSourceNode; processor: ScriptProcessorNode; mute: GainNode; turnId: TurnId; samples: number[]; resampleBuffer: number[]; resampleOffset: number; context: AudioContext } | null = null;
  private transcriptPromise: Promise<Transcript> | null = null;
  private resolveTranscript: ((value: Transcript) => void) | null = null;
  private rejectTranscript: ((error: Error) => void) | null = null;
  private transcriptTimer: ReturnType<typeof setTimeout> | null = null;
  private recordingTimer: ReturnType<typeof setTimeout> | null = null;
  private awaitingMic = false;
  private captureEpoch = 0;
  private lastSpeechEnd = 0;
  private firstAudioReceived = 0;
  private turnBegan = 0;
  private cancelledTurns = new Set<TurnId>();
  private rpc = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
  private realtimeRpc = false;
  constructor(private callbacks: VoiceCallbacks = {}) {
    this.player = new PcmPlayer((turnId, at) => {
      const timing = { firstScheduledMs: at - this.turnBegan, queuedSeconds: this.player.queuedSeconds, ...(this.lastSpeechEnd ? { speechEndToFirstScheduledMs: at - this.lastSpeechEnd } : {}), playbackDelayMs: at - this.firstAudioReceived, underruns: this.player.underruns };
      this.callbacks.onTiming?.(timing, turnId); this.send({ type: 'playback.timing', turnId, timings: timing }); this.callbacks.onStatus?.('speaking');
    });
  }
  async connect(sessionId: string, token?: string): Promise<void> {
    if (this.sessionId === sessionId && this.socket?.readyState === WebSocket.OPEN) return;
    if (this.sessionId === sessionId && this.connectionPromise) return this.connectionPromise;
    this.disconnect(); this.sessionId = sessionId;
    const url = new URL('/realtime', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    if (token) url.searchParams.set('token', token);
    const socket = new WebSocket(url); this.socket = socket;
    this.connectionPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Voice connection timed out.')), 8000);
      socket.onopen = () => socket.send(JSON.stringify({ type: 'hello', sessionId, token }));
      socket.onmessage = event => {
        if (this.socket !== socket) return;
        let message: any; try { message = JSON.parse(event.data); } catch { return; }
        if (message.sessionId && message.sessionId !== this.sessionId) return;
        if (message.type === 'ready') { clearTimeout(timer); this.realtimeRpc = Boolean(message.realtimeRpc); this.connectionPromise = null; this.callbacks.onStatus?.('ready'); resolve(); return; }
        this.receive(message);
      };
      socket.onerror = () => { clearTimeout(timer); this.callbacks.onStatus?.('offline', 'Voice unavailable. You can still type.'); reject(new Error('Voice connection failed.')); };
      socket.onclose = () => {
        clearTimeout(timer);
        if (this.socket === socket) {
          this.socket = null; this.connectionPromise = null;
          const detail = this.realtimeRpc ? 'Call connection closed. Start another call.' : 'Voice connection closed. You can still type.';
          this.cancelMicrophone(new Error(detail)); reject(new Error(detail));
          for (const pending of this.rpc.values()) { clearTimeout(pending.timeout); pending.reject(new Error(detail)); } this.rpc.clear();
          this.callbacks.onStatus?.('disconnected', detail);
        }
      };
    });
    return this.connectionPromise;
  }
  /** Call directly from Answer call / tap before awaiting HTTP or other network work. */
  async unlock() { await this.player.unlock(); }
  request(path: string, body?: unknown): Promise<any> {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('The game connection is unavailable.'));
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.rpc.delete(requestId); reject(new Error('The game request timed out.')); }, 15_000);
      this.rpc.set(requestId, { resolve, reject, timeout });
      this.send({ type: 'rpc', requestId, path, body });
    });
  }
  setMuted(muted: boolean) { this.player.setMuted(muted); }
  /** End microphone work without cancelling the courier's deadline/drop-off turn. */
  cancelRecording() {
    const pending = this.isRecording || this.resolveTranscript !== null;
    this.cancelMicrophone(new Error('Recording cancelled.'));
    if (pending) {
      if (this.currentTurn !== null) this.cancelledTurns.add(this.currentTurn);
      this.currentTurn = null;
    }
    this.send({ type: 'stt.cancel' });
  }
  beginTurn(turnId: TurnId) {
    if (this.currentTurn !== null && this.currentTurn !== turnId) this.cancelledTurns.add(this.currentTurn);
    this.currentTurn = turnId; this.turnBegan = performance.now(); this.firstAudioReceived = 0; this.player.beginTurn(turnId);
  }
  interrupt() {
    if (this.currentTurn !== null) this.cancelledTurns.add(this.currentTurn);
    const began = performance.now(); this.cancelMicrophone(new Error('Recording cancelled.')); this.player.stop(); this.currentTurn = null;
    this.send({ type: 'interrupt' });
    this.callbacks.onTiming?.({ interruptionStopMs: performance.now() - began }, 'interruption');
  }
  prepare() { this.send({ type: 'voice.prepare' }); }
  async startRecording(turnId: TurnId, language: SpeechLanguage = 'es'): Promise<boolean> {
    this.interrupt(); this.awaitingMic = true;
    const epoch = ++this.captureEpoch;
    let context: AudioContext;
    try { context = await this.player.unlock(); }
    catch (error) { if (epoch !== this.captureEpoch) return false; this.awaitingMic = false; throw error; }
    if (epoch !== this.captureEpoch || !this.awaitingMic) return false;
    if (!navigator.mediaDevices?.getUserMedia) { this.awaitingMic = false; throw new Error('Microphone requires HTTPS. Please type instead.'); }
    this.callbacks.onStatus?.('requesting-microphone');
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false }); }
    catch {
      if (epoch !== this.captureEpoch || !this.awaitingMic) return false;
      this.awaitingMic = false; this.callbacks.onStatus?.('microphone-denied', 'Microphone permission was denied. You can still type.'); throw new Error('Microphone permission was denied. Please type instead.');
    }
    if (epoch !== this.captureEpoch || !this.awaitingMic) { stream.getTracks().forEach(track => track.stop()); return false; }
    this.awaitingMic = false;
    if (this.socket?.readyState !== WebSocket.OPEN) { stream.getTracks().forEach(track => track.stop()); throw new Error('Voice is not connected. Please type instead.'); }
    this.currentTurn = turnId;
    this.transcriptPromise = new Promise((resolve, reject) => { this.resolveTranscript = resolve; this.rejectTranscript = reject; });
    // The Promise may fail while the player is still holding the button.
    void this.transcriptPromise.catch(() => {});
    const source = context.createMediaStreamSource(stream), processor = context.createScriptProcessor(2048, 1, 1), mute = context.createGain(); mute.gain.value = 0;
    const recording = { stream, source, processor, mute, turnId, samples: [] as number[], resampleBuffer: [] as number[], resampleOffset: 0, context };
    this.recording = recording;
    this.send({ type: 'stt.start', turnId, language: language === 'en' ? 'en' : 'es' });
    processor.onaudioprocess = event => {
      if (this.recording !== recording) return;
      const input = event.inputBuffer.getChannelData(0);
      // Linear resampling keeps continuity across browser chunks and arbitrary device rates.
      recording.resampleBuffer.push(...input);
      const ratio = context.sampleRate / 16_000;
      while (recording.resampleOffset + 1 < recording.resampleBuffer.length) {
        const index = Math.floor(recording.resampleOffset), fraction = recording.resampleOffset - index;
        recording.samples.push(recording.resampleBuffer[index] * (1 - fraction) + recording.resampleBuffer[index + 1] * fraction);
        recording.resampleOffset += ratio;
      }
      const consumed = Math.floor(recording.resampleOffset); recording.resampleBuffer.splice(0, consumed); recording.resampleOffset -= consumed;
      if (recording.samples.length >= 1600) this.flushCapture(recording);
    };
    source.connect(processor); processor.connect(mute); mute.connect(context.destination);
    this.recordingTimer = setTimeout(() => {
      void this.stopRecording().then(result => {
        if (epoch === this.captureEpoch) this.callbacks.onAutoTranscript?.(result);
      }).catch(error => {
        if (epoch === this.captureEpoch) this.callbacks.onStatus?.('transcription-error', error.message);
      });
    }, 14_000);
    this.callbacks.onStatus?.('recording');
    return true;
  }
  async stopRecording(): Promise<Transcript> {
    if (this.awaitingMic) { this.awaitingMic = false; this.captureEpoch++; throw new Error('Recording cancelled before microphone was ready.'); }
    const recording = this.recording;
    if (!recording || !this.transcriptPromise) throw new Error('No active recording.');
    this.flushCapture(recording); this.lastSpeechEnd = performance.now();
    this.stopCapture(); this.send({ type: 'stt.commit', turnId: recording.turnId }); this.callbacks.onStatus?.('transcribing');
    this.transcriptTimer = setTimeout(() => { this.rejectTranscript?.(new Error('Transcription timed out. Please type instead.')); this.resolveTranscript = null; this.rejectTranscript = null; }, 10_000);
    return this.transcriptPromise;
  }
  get isRecording() { return Boolean(this.recording || this.awaitingMic); }
  private flushCapture(recording: NonNullable<RealtimeVoice['recording']>) {
    if (!recording.samples.length) return;
    this.send({ type: 'stt.audio', turnId: recording.turnId, audio: encode(pcm16(recording.samples)) }); recording.samples = [];
  }
  private stopCapture() {
    if (this.recordingTimer) clearTimeout(this.recordingTimer); this.recordingTimer = null;
    const recording = this.recording; this.recording = null;
    if (!recording) return;
    recording.processor.onaudioprocess = null; recording.source.disconnect(); recording.processor.disconnect(); recording.mute.disconnect(); recording.stream.getTracks().forEach(track => track.stop());
  }
  private cancelMicrophone(error: Error) {
    this.awaitingMic = false; this.captureEpoch++; this.stopCapture();
    if (this.transcriptTimer) clearTimeout(this.transcriptTimer); this.transcriptTimer = null;
    this.rejectTranscript?.(error); this.resolveTranscript = null; this.rejectTranscript = null; this.transcriptPromise = null;
  }
  private receive(message: any) {
    if (message.type === 'rpc.result') {
      const pending = this.rpc.get(message.requestId); if (!pending) return;
      this.rpc.delete(message.requestId); clearTimeout(pending.timeout);
      if (message.error || (message.status && message.status >= 400)) pending.reject(new Error(message.error || `Game request failed (${message.status}).`)); else pending.resolve(message.result);
      return;
    }
    if (message.type === 'game.state') { this.callbacks.onState?.(message.state ?? message.game); return; }
    if (message.type === 'voice.prepared') { this.callbacks.onStatus?.(message.live ? 'prepared' : 'voice-unavailable'); return; }
    if (message.type === 'npc.audio_begin' && this.currentTurn === null && !this.recording && !this.awaitingMic && !this.cancelledTurns.has(message.turnId)) this.beginTurn(message.turnId);
    if (message.turnId !== this.currentTurn) return;
    if (message.type === 'npc.audio_begin') this.callbacks.onStatus?.('synthesizing');
    else if (message.type === 'npc.caption') this.callbacks.onCaption?.(message.text, message.turnId);
    else if (message.type === 'npc.audio') { this.firstAudioReceived ||= performance.now(); this.player.enqueueBase64(message.audio, message.turnId); }
    else if (message.type === 'npc.audio_end') { this.currentTurn = null; this.prepare(); this.callbacks.onStatus?.('audio-complete'); }
    else if (message.type === 'npc.cancel') { this.cancelledTurns.add(message.turnId); this.player.stop(); this.currentTurn = null; this.callbacks.onStatus?.('ready'); }
    else if (message.type === 'npc.audio_error') { this.player.stop(); this.callbacks.onStatus?.('voice-unavailable', 'Speech unavailable. Read the courier transcript.'); }
    else if (message.type === 'stt.partial') this.callbacks.onTranscript?.(message.text, false, message.turnId);
    else if (message.type === 'stt.final') {
      if (this.transcriptTimer) clearTimeout(this.transcriptTimer); this.transcriptTimer = null;
      this.callbacks.onTranscript?.(message.text, true, message.turnId); this.resolveTranscript?.({ text: message.text, turnId: message.turnId, model: message.model, live: message.live, elapsedMs: message.elapsedMs });
      this.resolveTranscript = null; this.rejectTranscript = null; this.callbacks.onStatus?.('ready');
    } else if (message.type === 'stt.error') {
      this.stopCapture(); if (this.transcriptTimer) clearTimeout(this.transcriptTimer); this.transcriptTimer = null;
      this.rejectTranscript?.(new Error(message.error)); this.resolveTranscript = null; this.rejectTranscript = null; this.callbacks.onStatus?.('transcription-error', message.error);
    }
  }
  private send(message: Record<string, unknown>) { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ ...message, sessionId: this.sessionId })); }
  disconnect() {
    this.cancelMicrophone(new Error('The game connection closed.')); this.player.stop(); this.currentTurn = null;
    const socket = this.socket; this.socket = null; socket?.close(); this.connectionPromise = null;
    for (const pending of this.rpc.values()) { clearTimeout(pending.timeout); pending.reject(new Error('The game connection closed.')); } this.rpc.clear();
  }
  async dispose() { this.disconnect(); await this.player.dispose(); }
}
