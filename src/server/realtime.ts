import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { cancelSpeech, closeSpeech, prewarmSpeech, relay, type TurnId } from './voice';
import { recordUsage } from './usage';

export interface RealtimeOptions {
  verifySession(sessionId: string, request?: IncomingMessage): boolean;
  onInterrupt?(sessionId: string, turnId?: TurnId): void;
  onTranscript?(sessionId: string, turnId: TurnId, text: string): void;
  onPlaybackTiming?(sessionId: string, turnId: TurnId, timings: Record<string, number>): void;
}
type SttState = { socket: WebSocket; turnId: TurnId; bytes: number; started: number; endedAt?: number; queue: string[]; ready: boolean; committed: boolean; timeout: ReturnType<typeof setTimeout> };

export function attachRealtime(server: Server, options: RealtimeOptions) {
  const wss = new WebSocketServer({ server, path: '/realtime', maxPayload: 64 * 1024 });
  const clients = new Map<string, WebSocket>();
  wss.on('connection', (client, request) => {
    let sessionId: string | undefined, stt: SttState | undefined, lastStart = 0;
    const helloTimer = setTimeout(() => { if (!sessionId) client.close(1008, 'Session required'); }, 5_000);
    const stopStt = () => { if (stt) { clearTimeout(stt.timeout); stt.socket.terminate(); stt = undefined; } };
    const failStt = (turnId: TurnId, error: string) => { relay(client, { type: 'stt.error', sessionId, turnId, error }); stopStt(); };
    const flushStt = () => {
      if (!stt?.ready) return;
      while (stt.queue.length) stt.socket.send(stt.queue.shift()!);
    };
    const startStt = (turnId: TurnId) => {
      if (!sessionId || !process.env.ELEVENLABS_API_KEY) { failStt(turnId, 'Microphone transcription is unavailable. Please type instead.'); return; }
      stopStt(); cancelSpeech(sessionId); options.onInterrupt?.(sessionId, turnId);
      const started = performance.now();
      const socket = new WebSocket('wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&audio_format=pcm_16000&commit_strategy=manual', { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }, handshakeTimeout: 8_000, maxPayload: 1024 * 1024 });
      const state: SttState = { socket, turnId, bytes: 0, started, queue: [], ready: false, committed: false, timeout: setTimeout(() => failStt(turnId, 'Recording timed out. Please try a shorter message.'), 18_000) };
      stt = state;
      socket.on('message', frame => {
        if (stt !== state) return;
        try {
          const message = JSON.parse(frame.toString());
          const type = message.message_type;
          if (type === 'session_started') { state.ready = true; flushStt(); relay(client, { type: 'stt.ready', sessionId, turnId }); }
          else if (type === 'partial_transcript') relay(client, { type: 'stt.partial', sessionId, turnId, text: message.text || '' });
          else if (type === 'committed_transcript' || type === 'committed_transcript_with_timestamps') {
            const text = String(message.text || '').trim();
            const elapsedMs = performance.now() - (state.endedAt || state.started);
            recordUsage({ provider: 'elevenlabs', operation: 'stt-realtime', model: 'scribe_v2_realtime', sessionId, turnId, audioSeconds: state.bytes / 32000, elapsedMs, live: true, outcome: text ? 'complete' : 'empty', estimatedCostUsd: state.bytes / 32000 / 3600 * .39 });
            relay(client, { type: 'stt.final', sessionId, turnId, text, elapsedMs, live: true, model: 'scribe_v2_realtime' });
            if (text) options.onTranscript?.(sessionId!, turnId, text);
            stopStt();
          } else if (String(type || '').includes('error') || message.error || ['auth_error', 'quota_exceeded', 'unaccepted_terms', 'resource_exhausted', 'rate_limited'].includes(type)) {
            failStt(turnId, `Transcription unavailable (${String(type || 'provider_error').slice(0, 40)}). Please type instead.`);
          }
        } catch { failStt(turnId, 'Invalid transcription event. Please type instead.'); }
      });
      socket.on('unexpected-response', (_req, response) => failStt(turnId, `Transcription access failed (${response.statusCode}). Please type instead.`));
      socket.on('error', () => { if (stt === state) failStt(turnId, 'Microphone connection failed. Please type instead.'); });
      socket.on('close', () => { if (stt === state) failStt(turnId, 'Microphone connection closed. Please type instead.'); });
    };
    client.on('message', raw => {
      let message: Record<string, any>;
      try { message = JSON.parse(raw.toString()); } catch { client.close(1008, 'Invalid message'); return; }
      if (message.type === 'hello') {
        if (sessionId) return;
        const supplied = String(message.sessionId || '');
        if (supplied.length > 100 || !options.verifySession(supplied, request)) { client.close(1008, 'Invalid session'); return; }
        sessionId = supplied; clearTimeout(helloTimer);
        const old = clients.get(sessionId); if (old && old !== client) old.close(1000, 'Reconnected');
        clients.set(sessionId, client);
        relay(client, { type: 'ready', sessionId, speechModel: 'eleven_v4_turbo', transcriptionModel: 'scribe_v2_realtime' });
        void prewarmSpeech(sessionId).then(live => relay(client, { type: 'voice.prepared', sessionId, live }));
        return;
      }
      if (!sessionId || (message.sessionId && message.sessionId !== sessionId)) return;
      if (message.type === 'interrupt') { cancelSpeech(sessionId); stopStt(); options.onInterrupt?.(sessionId, message.turnId); }
      else if (message.type === 'voice.prepare') void prewarmSpeech(sessionId);
      else if (message.type === 'stt.start') {
        if (performance.now() - lastStart < 800 || !['string', 'number'].includes(typeof message.turnId)) return;
        lastStart = performance.now(); startStt(message.turnId);
      } else if (message.type === 'stt.audio' && stt && !stt.committed && message.turnId === stt.turnId) {
        const base64 = String(message.audio || '');
        if (base64.length > 48_000 || !/^[A-Za-z0-9+/=]*$/.test(base64)) return;
        const bytes = Buffer.from(base64, 'base64');
        if (stt.bytes + bytes.length > 512_000) { failStt(stt.turnId, 'Message too long. Please use a shorter sentence.'); return; }
        stt.bytes += bytes.length;
        stt.queue.push(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: base64, sample_rate: 16000, commit: false })); flushStt();
      } else if (message.type === 'stt.commit' && stt && !stt.committed && message.turnId === stt.turnId) {
        stt.committed = true; stt.endedAt = performance.now();
        // Scribe starts processing after two seconds of audio. Pad brief turns with silence.
        const silence = Buffer.alloc(Math.max(1600, 64_000 - stt.bytes));
        stt.bytes += silence.length;
        stt.queue.push(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: silence.toString('base64'), sample_rate: 16000, commit: true })); flushStt();
      } else if (message.type === 'playback.timing' && message.turnId !== undefined && message.timings) {
        const timings: Record<string, number> = {};
        for (const key of ['firstScheduledMs', 'queuedSeconds', 'interruptionStopMs', 'speechEndToFirstScheduledMs', 'playbackDelayMs', 'underruns']) if (Number.isFinite(message.timings[key])) timings[key] = message.timings[key];
        options.onPlaybackTiming?.(sessionId, message.turnId, timings);
      }
    });
    client.on('close', () => {
      clearTimeout(helloTimer); stopStt();
      if (sessionId && clients.get(sessionId) === client) { clients.delete(sessionId); closeSpeech(sessionId); options.onInterrupt?.(sessionId); }
    });
    client.on('error', () => {});
  });
  return { getClient: (sessionId: string) => clients.get(sessionId), send: (sessionId: string, message: unknown) => relay(clients.get(sessionId), message), close: () => wss.close(), clients };
}
