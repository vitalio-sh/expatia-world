// Server-side one-shot example. Requires the ws package and environment values.
// Saves streaming MP3 bytes; it does not provide browser playback.
import WebSocket from 'ws';
import { mkdirSync, openSync, closeSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const modelId = 'eleven_v4_turbo';
const outputFormat = 'mp3_44100_128';
const apiKey = process.env.ELEVENLABS_API_KEY;
const voiceId = process.env.ELEVENLABS_VOICE_ID;
const text = process.argv.slice(2).join(' ').trim();
if (!apiKey || !voiceId || apiKey.startsWith('replace_') || voiceId.startsWith('replace_') || !text) {
  console.error('Configure API key and voice ID, then pass the spoken text as an argument.');
  process.exit(1);
}

const query = new URLSearchParams({ model_id: modelId, output_format: outputFormat });
if (process.env.ELEVENLABS_LANGUAGE_CODE) query.set('language_code', process.env.ELEVENLABS_LANGUAGE_CODE);
const uri = `wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?${query}`;
const output = resolve(process.env.ELEVENLABS_OUTPUT_FILE || 'output/dialogue.mp3');
mkdirSync(dirname(output), { recursive: true });
const file = openSync(output, 'w');
let bytesReceived = 0;
let firstAudioMs = null;
let textSentAt;

try {
  await new Promise((accept, reject) => {
    const socket = new WebSocket(uri, {
      headers: { 'xi-api-key': apiKey },
      handshakeTimeout: 10000,
      maxPayload: 4 * 1024 * 1024,
    });
    let settled = false;
    const timer = setTimeout(() => finish(new Error('Generation timed out; output may be partial.')), 45000);
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        socket.terminate();
        reject(error);
      } else {
        socket.close();
        accept();
      }
    }
    socket.on('open', () => {
      try {
        socket.send(JSON.stringify({ voices: [voiceId] }));
        textSentAt = performance.now();
        socket.send(JSON.stringify({ inputs: [{ text, voice_id: voiceId, new_turn: false }] }));
        // Requests a flush and final event; it is not a cancellation command.
        socket.send(JSON.stringify({ close_socket: true }));
      } catch (error) {
        finish(error);
      }
    });
    socket.on('message', (frame) => {
      if (settled) return;
      try {
        const message = JSON.parse(frame.toString());
        if (message.error) throw new Error(`Provider error: ${message.error} (code ${message.code})`);
        if (message.audio) {
          const chunk = Buffer.from(message.audio, 'base64');
          if (chunk.length) {
            if (firstAudioMs === null) firstAudioMs = performance.now() - textSentAt;
            // writeSync can return a short write; preserve every byte.
            let offset = 0;
            while (offset < chunk.length) {
              const written = writeSync(file, chunk, offset, chunk.length - offset);
              if (!written) throw new Error('Unable to write audio output.');
              offset += written;
            }
            bytesReceived += chunk.length;
          }
        }
        if (message.is_final) {
          if (!bytesReceived) throw new Error('Provider finished without audio.');
          finish();
        }
      } catch (error) {
        finish(error);
      }
    });
    socket.on('error', finish);
    socket.on('close', (code) => {
      if (!settled) finish(new Error(`Socket closed before final audio (code ${code}); output may be partial.`));
    });
  });
  console.log(JSON.stringify({
    model_id: modelId,
    output_format: outputFormat,
    output,
    audio_bytes: bytesReceived,
    tts_first_chunk_ms: Number(firstAudioMs.toFixed(1)),
    metric_scope: 'text submission to first received audio; excludes connection setup and playback',
  }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  closeSync(file);
}
