import { cleanSpeech } from './dialogue';
import { recordUsage } from './usage';

type TurnId = string | number;
interface NativeSocket { readyState: number; send(data: string): void; close(code?: number, reason?: string): void; accept(): void; addEventListener(type: string, handler: (event: any) => void): void }
interface VoiceClient { readyState: number; send(data: string): void }
export interface WorkerVoiceEnv { ELEVENLABS_API_KEY?: string; EXPATIA_COURIER_VOICE?: string }
export interface WorkerSpeechResult { live: boolean; model: string; characters: number; audioBytes: number; timings: { connectMs: number; firstAudioMs?: number; elapsedMs: number }; error?: string }
export interface WorkerSpeechTurn { sendPhrase(text: string): void; finish(): Promise<WorkerSpeechResult>; cancel(): void }
export interface WorkerVoiceCallbacks {
  onInterrupt?(turnId?: TurnId): void;
  onPlaybackTiming?(turnId: TurnId, timings: Record<string, number>): void;
  onTranscript?(turnId: TurnId, text: string): void;
}
type Prepared = { socket: NativeSocket; at: number; heartbeat: ReturnType<typeof setInterval>; expiry: ReturnType<typeof setTimeout> };
type Stt = { socket: NativeSocket | null; turnId: TurnId; bytes: number; started: number; endedAt?: number; committed: boolean; ready: boolean; queue: string[]; timeout: ReturnType<typeof setTimeout> };

function pcmSilenceBase64(bytes: number) { return btoa('\0'.repeat(bytes)); }
function base64Bytes(text: string) { return Math.floor(text.length * .75) - (text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0); }

/** Native Cloudflare outbound WS adapter. No Node ws package, credentials stay in Worker bindings. */
export class WorkerVoice {
  private warmed: Prepared | null = null;
  private preparing: Promise<boolean> | null = null;
  private active: { turnId: TurnId; cancel: () => void } | null = null;
  private stt: Stt | null = null;
  private disposed = false;
  private lastStart = -1000;
  private voiceId: string;
  constructor(private client: VoiceClient, private env: WorkerVoiceEnv, private sessionId: string, private callbacks: WorkerVoiceCallbacks = {}) { this.voiceId = env.EXPATIA_COURIER_VOICE || 'iP95p4xoKVk53GoZ742B'; }
  private send(message: Record<string, unknown>) { if (this.client.readyState === 1 && !this.disposed) this.client.send(JSON.stringify({ ...message, sessionId: this.sessionId })); }
  private async connect(path: string): Promise<NativeSocket> {
    if (!this.env.ELEVENLABS_API_KEY) throw new Error('eleven_not_configured');
    const response = await fetch(`https://api.elevenlabs.io${path}`, { headers: { Upgrade: 'websocket', 'xi-api-key': this.env.ELEVENLABS_API_KEY } });
    const socket = (response as Response & { webSocket?: NativeSocket }).webSocket;
    if (response.status !== 101 || !socket) throw new Error(`eleven_upgrade_${response.status}`);
    socket.accept();
    return socket;
  }
  async prepare(): Promise<boolean> {
    if (this.disposed) return false;
    if (this.warmed?.socket.readyState === 1) return true;
    if (this.preparing) return this.preparing;
    this.preparing = (async () => {
      try {
        const socket = await this.connect('/v1/text-to-dialogue/stream-input?model_id=eleven_v4_turbo&output_format=pcm_24000');
        if (this.disposed) { socket.close(); return false; }
        socket.send(JSON.stringify({ voices: [this.voiceId] }));
        const heartbeat = setInterval(() => { if (socket.readyState === 1) socket.send(JSON.stringify({ keep_alive: true })); }, 10_000);
        const expiry = setTimeout(() => { if (this.warmed?.socket === socket) this.releaseWarm(); }, 90_000);
        const warmed = { socket, at: performance.now(), heartbeat, expiry }; this.warmed = warmed;
        socket.addEventListener('error', () => { if (this.warmed === warmed) this.releaseWarm(); });
        socket.addEventListener('close', () => { if (this.warmed === warmed) this.releaseWarm(); });
        this.send({ type: 'voice.prepared', live: true });
        return true;
      } catch { this.send({ type: 'voice.prepared', live: false }); return false; }
      finally { this.preparing = null; }
    })();
    return this.preparing;
  }
  private releaseWarm() {
    const warmed = this.warmed; this.warmed = null;
    if (!warmed) return;
    clearInterval(warmed.heartbeat); clearTimeout(warmed.expiry); try { warmed.socket.close(); } catch { /* disconnected */ }
  }
  async createTurn(turnId: TurnId, signal?: AbortSignal): Promise<WorkerSpeechTurn> {
    this.active?.cancel(); signal?.throwIfAborted();
    const started = performance.now();
    if (!this.warmed) await this.prepare();
    const warmed = this.warmed; this.warmed = null;
    if (!warmed || warmed.socket.readyState !== 1) throw new Error('speech_connection_unavailable');
    clearInterval(warmed.heartbeat); clearTimeout(warmed.expiry);
    const socket = warmed.socket;
    if (signal?.aborted || this.disposed) { socket.close(); signal?.throwIfAborted(); throw new Error('voice_disposed'); }
    const connectMs = performance.now() - started;
    let settled = false, closing = false, characters = 0, audioBytes = 0, textSentAt: number | undefined, firstAudioMs: number | undefined;
    let resolveResult!: (result: WorkerSpeechResult) => void;
    const result = new Promise<WorkerSpeechResult>(resolve => { resolveResult = resolve; });
    const abort = () => end('cancelled');
    const timer = setTimeout(() => end('speech_timeout'), 20_000);
    const owner = { turnId, cancel: abort }; this.active = owner;
    const owned = () => this.active === owner && !settled && !signal?.aborted && !this.disposed;
    const end = (error?: string) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (this.active === owner) this.active = null;
      try { socket.close(); } catch { /* disconnected */ }
      const measured: WorkerSpeechResult = { live: !error && audioBytes > 0, model: 'eleven_v4_turbo', characters, audioBytes, timings: { connectMs, firstAudioMs, elapsedMs: performance.now() - started }, ...(error ? { error } : {}) };
      recordUsage({ provider: 'elevenlabs', operation: 'ttd-worker-stream', sessionId: this.sessionId, turnId, model: measured.model, characters, audioBytes, audioSeconds: audioBytes / 48_000, firstAudioMs, elapsedMs: measured.timings.elapsedMs, live: measured.live, outcome: error || 'complete', estimatedCostUsd: characters / 1000 * .04 });
      this.send({ type: error === 'cancelled' ? 'npc.cancel' : error ? 'npc.audio_error' : 'npc.audio_end', turnId, live: measured.live, error, timings: measured.timings });
      resolveResult(measured);
    };
    signal?.addEventListener('abort', abort, { once: true });
    this.send({ type: 'npc.audio_begin', turnId, format: 'pcm_24000', model: 'eleven_v4_turbo' });
    socket.addEventListener('message', event => {
      if (!owned()) return;
      try {
        const message = JSON.parse(String(event.data));
        if (message.error) { end(`eleven_${String(message.error).slice(0, 50)}`); return; }
        if (message.audio) {
          const count = base64Bytes(message.audio);
          if (count > 0) { firstAudioMs ??= performance.now() - (textSentAt || started); audioBytes += count; this.send({ type: 'npc.audio', turnId, format: 'pcm_24000', audio: message.audio }); }
        }
        if (message.is_final) end(audioBytes ? undefined : 'empty_audio');
      } catch { end('invalid_audio_event'); }
    });
    socket.addEventListener('error', () => end('eleven_connection_error'));
    socket.addEventListener('close', () => { if (!settled) end('eleven_closed_before_final'); });
    return {
      sendPhrase: raw => {
        if (!owned() || closing) return;
        const text = cleanSpeech(raw); if (!text || characters + text.length > 700) return;
        textSentAt ??= performance.now(); characters += text.length;
        this.send({ type: 'npc.caption', turnId, text });
        socket.send(JSON.stringify({ inputs: [{ text: `${text} `, voice_id: this.voiceId, new_turn: false }] })); socket.send(JSON.stringify({ flush: true }));
      },
      finish: () => { if (!settled && !closing) { closing = true; socket.send(JSON.stringify({ close_socket: true })); } return result; },
      cancel: abort,
    };
  }
  handle(message: Record<string, any>) {
    if (this.disposed || (message.sessionId && message.sessionId !== this.sessionId)) return;
    if (message.type === 'interrupt') { this.active?.cancel(); this.stopStt(); this.callbacks.onInterrupt?.(message.turnId); }
    else if (message.type === 'voice.prepare') void this.prepare();
    else if (message.type === 'stt.start' && ['string', 'number'].includes(typeof message.turnId) && performance.now() - this.lastStart >= 800) { this.lastStart = performance.now(); void this.startStt(message.turnId); }
    else if (message.type === 'stt.audio' && this.stt && message.turnId === this.stt.turnId && !this.stt.committed) {
      const base64 = String(message.audio || ''); if (base64.length > 48_000 || !/^[A-Za-z0-9+/=]*$/.test(base64)) return;
      const count = base64Bytes(base64);
      if (this.stt.bytes + count > 512_000) { this.failStt('Message too long. Please use a shorter sentence.'); return; }
      this.stt.bytes += count; this.stt.queue.push(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: base64, sample_rate: 16000, commit: false })); this.flushStt();
    } else if (message.type === 'stt.commit' && this.stt && message.turnId === this.stt.turnId && !this.stt.committed) {
      this.stt.committed = true; this.stt.endedAt = performance.now();
      const padding = Math.max(1600, 64_000 - this.stt.bytes); this.stt.bytes += padding;
      this.stt.queue.push(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: pcmSilenceBase64(padding), sample_rate: 16000, commit: true })); this.flushStt();
    } else if (message.type === 'playback.timing' && message.turnId !== undefined && message.timings) {
      const timings: Record<string, number> = {};
      for (const key of ['firstScheduledMs', 'queuedSeconds', 'interruptionStopMs', 'speechEndToFirstScheduledMs', 'playbackDelayMs', 'underruns']) if (Number.isFinite(message.timings[key])) timings[key] = message.timings[key];
      this.callbacks.onPlaybackTiming?.(message.turnId, timings);
    }
  }
  private async startStt(turnId: TurnId) {
    this.active?.cancel(); this.stopStt(); this.callbacks.onInterrupt?.(turnId);
    const state: Stt = { socket: null, turnId, bytes: 0, started: performance.now(), committed: false, ready: false, queue: [], timeout: setTimeout(() => this.failStt('Recording timed out. Please type instead.'), 18_000) };
    this.stt = state;
    try {
      const socket = await this.connect('/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&audio_format=pcm_16000&language_code=en&commit_strategy=manual');
      if (this.stt !== state || this.disposed) { socket.close(); return; }
      state.socket = socket;
      socket.addEventListener('message', event => {
        if (this.stt !== state) return;
        try {
          const message = JSON.parse(String(event.data)), type = message.message_type;
          if (type === 'session_started') { state.ready = true; this.flushStt(); this.send({ type: 'stt.ready', turnId }); }
          else if (type === 'partial_transcript') this.send({ type: 'stt.partial', turnId, text: message.text || '' });
          else if (type === 'committed_transcript' || type === 'committed_transcript_with_timestamps') {
            const text = String(message.text || '').trim(), elapsedMs = performance.now() - (state.endedAt || state.started);
            recordUsage({ provider: 'elevenlabs', operation: 'stt-worker-realtime', model: 'scribe_v2_realtime', sessionId: this.sessionId, turnId, audioSeconds: state.bytes / 32_000, elapsedMs, live: true, outcome: text ? 'complete' : 'empty', estimatedCostUsd: state.bytes / 32_000 / 3600 * .39 });
            this.send({ type: 'stt.final', turnId, text, elapsedMs, live: true, model: 'scribe_v2_realtime' });
            if (text) this.callbacks.onTranscript?.(turnId, text); this.stopStt();
          } else if (String(type || '').includes('error') || message.error || ['auth_error', 'quota_exceeded', 'unaccepted_terms', 'resource_exhausted', 'rate_limited'].includes(type)) this.failStt(`Transcription unavailable (${String(type || 'provider_error').slice(0, 40)}). Please type instead.`);
        } catch { this.failStt('Invalid transcription event. Please type instead.'); }
      });
      socket.addEventListener('error', () => { if (this.stt === state) this.failStt('Microphone connection failed. Please type instead.'); });
      socket.addEventListener('close', () => { if (this.stt === state) this.failStt('Microphone connection closed. Please type instead.'); });
    } catch { if (this.stt === state) this.failStt('Transcription connection is unavailable. Please type instead.'); }
  }
  private flushStt() { const stt = this.stt; if (!stt?.ready || !stt.socket) return; while (stt.queue.length) stt.socket.send(stt.queue.shift()!); }
  private failStt(error: string) { if (this.stt) this.send({ type: 'stt.error', turnId: this.stt.turnId, error }); this.stopStt(); }
  private stopStt() { const stt = this.stt; this.stt = null; if (stt) { clearTimeout(stt.timeout); try { stt.socket?.close(); } catch { /* disconnected */ } } }
  cancel() { this.active?.cancel(); }
  dispose() { this.disposed = true; this.active?.cancel(); this.stopStt(); this.releaseWarm(); }
}
